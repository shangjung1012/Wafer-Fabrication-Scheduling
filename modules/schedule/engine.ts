import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/lib/generated/prisma";
import {
  greedyBestFitStrategy,
  type SchedulingCapacityInput,
  type SchedulingConfig,
} from "@/modules/schedule/strategy";
import {
  findOrdersForScheduling,
  bulkUpdateOrderStatus,
} from "@/infra/db/order-repository";
import { findFactoriesWithCapacities } from "@/infra/db/factory-repository";
import {
  deleteScheduledAssignments,
  createAssignments,
} from "@/infra/db/assignment-repository";
import {
  createDailyCapacities,
  updateDailyCapacityById,
} from "@/infra/db/capacity-repository";
import { AssignmentStatus } from "@/lib/generated/prisma";

export async function runSchedule(
  type: string,
  config: SchedulingConfig,
  currentDate: Date = new Date(),
): Promise<void> {
  const orders = await findOrdersForScheduling(prisma, type);
  const factories = await findFactoriesWithCapacities(prisma, type);

  // In-memory reset: restore capacity used by SCHEDULED assignments
  const capacities: SchedulingCapacityInput[] = [];
  for (const factory of factories) {
    if (factory.dailyCapacities) {
      capacities.push(...factory.dailyCapacities);
    }
  }

  if (config.reschedulePolicy !== "GAP_FILLING") {
    for (const order of orders) {
      if (order.assignments) {
        const remainingAssignments = [];
        for (const assignment of order.assignments) {
          if (assignment.status === AssignmentStatus.SCHEDULED) {
            // GLOBAL_OPTIMIZE or PRIORITY_RETAIN
            const prodDate = new Date(assignment.productionDate).getTime();
            const startLimit = config.startDate.getTime();
            const endLimit = config.endDate
              ? config.endDate.getTime()
              : Infinity;

            if (prodDate >= startLimit && prodDate <= endLimit) {
              const cap = capacities.find(
                (c) =>
                  c.factoryId === assignment.factoryId &&
                  new Date(c.date).getTime() === prodDate,
              );
              if (cap) cap.curCapacity += assignment.assignedQuantity;
            } else {
              remainingAssignments.push(assignment);
            }
          } else {
            remainingAssignments.push(assignment);
          }
        }
        order.assignments = remainingAssignments;
      }
    }
  }

  const strategyResult = greedyBestFitStrategy.execute(
    orders,
    factories,
    capacities,
    config,
    currentDate,
  );
  const processedOrderIds = strategyResult.processedOrders.map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    const db = tx as unknown as PrismaClient;

    if (config.reschedulePolicy !== "GAP_FILLING") {
      await deleteScheduledAssignments(
        db,
        processedOrderIds,
        config.startDate,
        config.endDate,
      );
    }

    await bulkUpdateOrderStatus(
      db,
      strategyResult.processedOrders.map((o) => ({
        id: o.id,
        status: o.status,
      })),
    );

    await createDailyCapacities(db, strategyResult.newCapacities);

    for (const cap of strategyResult.updatedCapacities) {
      await updateDailyCapacityById(db, cap.id, cap.curCapacity);
    }

    await createAssignments(db, strategyResult.newAssignments);
  });
}
