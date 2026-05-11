import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/lib/generated/prisma";
import {
  greedyBestFitStrategy,
  type SchedulingCapacityInput,
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

export async function runSchedule(type: string): Promise<void> {
  const orders = await findOrdersForScheduling(prisma, type);
  const factories = await findFactoriesWithCapacities(prisma, type);

  // In-memory reset: restore capacity used by SCHEDULED assignments
  const capacities: SchedulingCapacityInput[] = [];
  for (const factory of factories) {
    if (factory.dailyCapacities) {
      capacities.push(...factory.dailyCapacities);
    }
  }

  for (const order of orders) {
    if (order.assignments) {
      const remainingAssignments = [];
      for (const assignment of order.assignments) {
        if (assignment.status === AssignmentStatus.SCHEDULED) {
          const cap = capacities.find(
            (c) =>
              c.factoryId === assignment.factoryId &&
              new Date(c.date).getTime() ===
                new Date(assignment.productionDate).getTime(),
          );
          if (cap) cap.curCapacity += assignment.assignedQuantity;
        } else {
          remainingAssignments.push(assignment);
        }
      }
      order.assignments = remainingAssignments;
    }
  }

  const currentDate = new Date();
  const strategyResult = greedyBestFitStrategy(
    orders,
    factories,
    capacities,
    currentDate,
  );
  const processedOrderIds = strategyResult.processedOrders.map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    const db = tx as unknown as PrismaClient;

    await deleteScheduledAssignments(db, processedOrderIds);

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
