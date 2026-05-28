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
import { createIssuesForFailedOrdersTx } from "@/modules/order/conflict-issue-service";
import { calculateMinimumStartDate } from "@/modules/schedule/validation-utils";

export async function prepareSchedulingData(
  type: string,
  config: SchedulingConfig,
  currentDate: Date,
  fetchAllPending: boolean = false,
) {
  const orders = await findOrdersForScheduling(
    prisma,
    type,
    config.targetOrderIds,
    fetchAllPending,
  );
  const factories = await findFactoriesWithCapacities(
    prisma,
    type,
    currentDate,
  );

  // Calculate minimumStartDate = currentDate + 1 day + config.frozenDays (normalized to UTC midnight)
  const minimumStartDate = calculateMinimumStartDate(
    currentDate,
    config.frozenDays,
  );

  // Auto-correct config.startDate if it's earlier than minimumStartDate
  if (
    !config.startDate ||
    new Date(config.startDate).getTime() < minimumStartDate.getTime()
  ) {
    config.startDate = minimumStartDate;
  } else {
    // Normalize existing startDate to UTC midnight
    config.startDate = new Date(
      Date.UTC(
        new Date(config.startDate).getUTCFullYear(),
        new Date(config.startDate).getUTCMonth(),
        new Date(config.startDate).getUTCDate(),
      ),
    );
  }

  // In-memory reset: restore capacity used by SCHEDULED assignments
  const dbCapacities: SchedulingCapacityInput[] = [];
  const capacities: SchedulingCapacityInput[] = [];
  for (const factory of factories) {
    if (factory.dailyCapacities) {
      dbCapacities.push(...factory.dailyCapacities.map((c) => ({ ...c })));
      capacities.push(...factory.dailyCapacities.map((c) => ({ ...c })));
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

  return { orders, factories, capacities, dbCapacities };
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

  let deferredEmails: Array<() => Promise<void>> = [];

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

    // Atomically create conflict issues for any orders that failed scheduling
    if (failedIds.length > 0) {
      const { emailsToDispatch } = await createIssuesForFailedOrdersTx(
        db,
        failedIds,
        operatorId,
        config,
        new Date(),
      );
      deferredEmails = emailsToDispatch;
    }
  });

  // Execute emails safely outside the database transaction
  if (deferredEmails.length > 0) {
    Promise.allSettled(deferredEmails.map((fn) => fn())).catch((err) => {
      console.error(
        "[_applyScheduleTransaction] Error dispatching emails:",
        err,
      );
    });
  }

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
