import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/lib/generated/prisma";
import {
  type SchedulingCapacityInput,
  type SchedulingConfig,
  type StrategyResult,
} from "@/modules/schedule/strategy";
import {
  findOrdersForScheduling,
  applyScheduleOrdersUpdate,
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
import { AssignmentStatus, OrderStatus } from "@/lib/generated/prisma";
import { withScheduleLock } from "@/infra/redis/schedule-store";

export async function prepareSchedulingData(
  type: string,
  config: SchedulingConfig,
  currentDate: Date,
) {
  const orders = await findOrdersForScheduling(
    prisma,
    type,
    config.targetOrderIds,
  );
  const factories = await findFactoriesWithCapacities(
    prisma,
    type,
    currentDate,
  );

  // In-memory reset: restore capacity used by SCHEDULED assignments
  const capacities: SchedulingCapacityInput[] = [];
  for (const factory of factories) {
    if (factory.dailyCapacities) {
      capacities.push(...factory.dailyCapacities);
    }
  }

  if (config.reschedulePolicy !== "GAP_FILLING") {
    for (const order of orders) {
      const isImmutable =
        order.isFixed ||
        order.status === OrderStatus.IN_PRODUCTION ||
        order.status === OrderStatus.COMPLETED;

      if (order.assignments) {
        const remainingAssignments = [];
        for (const assignment of order.assignments) {
          if (
            assignment.status === AssignmentStatus.SCHEDULED &&
            !isImmutable
          ) {
            // GLOBAL_OPTIMIZE or PRIORITY_RETAIN for mutable orders
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

  return { orders, factories, capacities };
}

export async function _applyScheduleTransaction(
  type: string,
  config: SchedulingConfig,
  strategyResult: StrategyResult,
  operatorId: string = "system-user",
): Promise<{ failedIds: string[] }> {
  const scheduledIds = strategyResult.processedOrders
    .filter((o) => o.status === OrderStatus.SCHEDULED)
    .map((o) => o.id);

  const failedIds = strategyResult.processedOrders
    .filter((o) => o.status === OrderStatus.FAILED)
    .map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    const db = tx as unknown as PrismaClient;

    if (config.reschedulePolicy !== "GAP_FILLING") {
      // Only delete assignments for mutable orders
      const mutableProcessedOrderIds = strategyResult.processedOrders
        .filter(
          (o) =>
            !o.isFixed &&
            o.status !== OrderStatus.IN_PRODUCTION &&
            o.status !== OrderStatus.COMPLETED,
        )
        .map((o) => o.id);

      if (mutableProcessedOrderIds.length > 0) {
        await deleteScheduledAssignments(
          db,
          mutableProcessedOrderIds,
          config.startDate,
          config.endDate,
        );
      }
    }

    await applyScheduleOrdersUpdate(db, scheduledIds, failedIds, operatorId);

    await createDailyCapacities(db, strategyResult.newCapacities);

    for (const cap of strategyResult.updatedCapacities) {
      await updateDailyCapacityById(db, cap.id, cap.curCapacity);
    }

    await createAssignments(db, strategyResult.newAssignments);
  });

  return { failedIds };
}

export async function applyScheduleTransaction(
  type: string,
  config: SchedulingConfig,
  strategyResult: StrategyResult,
  operatorId: string = "system-user",
): Promise<{ failedIds: string[] }> {
  return withScheduleLock(type, async () => {
    return _applyScheduleTransaction(type, config, strategyResult, operatorId);
  });
}
