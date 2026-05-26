import type { PrismaClient } from "@/lib/generated/prisma";
import { AssignmentStatus, OrderStatus } from "@/lib/generated/prisma";
import {
  findAssignmentsByIds,
  updateAssignmentSlot,
  createAssignments,
} from "@/infra/db/assignment-repository";
import {
  upsertDailyCapacityDelta,
  findDailyCapacity,
} from "@/infra/db/capacity-repository";
import {
  findOrderById,
  bulkUpdateOrderStatusAndModifiedBy,
  bulkUpdateOrderModifiedBy,
} from "@/infra/db/order-repository";
import { findFactoriesMaxCapacity } from "@/infra/db/factory-repository";
import { getOperatingAutoSchedulerConfigs } from "@/infra/db/auto-scheduler-config-repository";

import { withScheduleLock } from "@/infra/redis/schedule-store";
import { calculateOrderDeadline } from "./validation-utils";

export type AssignmentMove = {
  assignmentId?: string;
  orderId?: string;
  factoryId: string;
  productionDate: string; // YYYY-MM-DD
  quantity?: number;
};

export type ManualEditViolation = {
  targetId: string;
  code:
    | "CAPACITY_EXCEEDED"
    | "DEADLINE_VIOLATION"
    | "INVALID_STATE"
    | "NOT_FOUND";
  reason: string;
};

export class ManualEditValidationError extends Error {
  constructor(public violations: ManualEditViolation[]) {
    super("Manual edit validation failed");
    this.name = "ManualEditValidationError";
  }
}

export type AssignmentMoveResult = {
  applied: number;
};

function toMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function applyAssignmentMoves(
  db: PrismaClient,
  moves: AssignmentMove[],
  actorUserId: string,
): Promise<AssignmentMoveResult> {
  if (moves.length === 0) {
    return { applied: 0 };
  }

  const violations: ManualEditViolation[] = [];

  // 1. Fetch data
  const assignmentIds = moves
    .map((m) => m.assignmentId)
    .filter(Boolean) as string[];

  const [assignments, configs, factories] = await Promise.all([
    assignmentIds.length > 0 ? findAssignmentsByIds(db, assignmentIds) : [],
    getOperatingAutoSchedulerConfigs(db),
    findFactoriesMaxCapacity(db),
  ]);

  const assignmentMap = new Map(assignments.map((a) => [a.id, a]));
  const configMap = new Map(configs.map((c) => [c.type, c]));
  const factoryMap = new Map(factories.map((f) => [f.id, f]));

  // In-memory cumulative capacity tracker
  // Map of `${factoryId}_${date}` -> net change
  const cumulativeCapacityDelta = new Map<string, number>();

  // To track valid actions to apply in transaction
  const validActions: {
    move: AssignmentMove;
    type: "MOVE_ASSIGNMENT" | "SCHEDULE_PENDING";
    orderId: string;
    qty: number;
    orderType: string;
    dueDate: Date;
    oldFactoryId?: string;
    oldDate?: Date;
    oldCompletionDate?: Date;
  }[] = [];

  // 2. Pass 1: Accumulate & Validate non-capacity constraints
  const movesIntoSlot = new Map<string, string[]>();
  const orderOriginalQtyMap = new Map<string, number>();

  for (const move of moves) {
    const targetDate = toMidnight(move.productionDate);
    const targetKey = `${move.factoryId}_${move.productionDate}`;

    let orderId: string;
    let qty: number;
    let orderType: string;
    let dueDate: Date;
    let actionType: "MOVE_ASSIGNMENT" | "SCHEDULE_PENDING";
    let oldFactoryId: string | undefined;
    let oldDate: Date | undefined;
    let oldCompletionDate: Date | undefined;

    if (move.assignmentId) {
      const existing = assignmentMap.get(move.assignmentId);
      if (!existing) {
        violations.push({
          targetId: move.assignmentId,
          code: "NOT_FOUND",
          reason: "Assignment not found",
        });
        continue;
      }
      if (existing.order.isFixed) {
        violations.push({
          targetId: move.assignmentId,
          code: "INVALID_STATE",
          reason: "Cannot move a fixed order",
        });
        continue;
      }
      if (existing.status !== AssignmentStatus.SCHEDULED) {
        violations.push({
          targetId: move.assignmentId,
          code: "INVALID_STATE",
          reason: `Cannot move assignment in status ${existing.status}`,
        });
        continue;
      }
      orderId = existing.orderId;
      qty = existing.assignedQuantity;
      orderType = existing.order.type;
      dueDate = existing.order.dueDate;
      actionType = "MOVE_ASSIGNMENT";
      oldFactoryId = existing.factoryId;
      oldDate = new Date(existing.productionDate);
      oldCompletionDate = new Date(existing.completionDate);

      const sameSlot =
        existing.factoryId === move.factoryId &&
        oldDate.getTime() === targetDate.getTime();
      if (sameSlot) continue;
    } else if (move.orderId) {
      const order = await findOrderById(db, move.orderId);
      if (!order) {
        violations.push({
          targetId: move.orderId,
          code: "NOT_FOUND",
          reason: "Order not found",
        });
        continue;
      }
      if (order.isFixed) {
        violations.push({
          targetId: move.orderId,
          code: "INVALID_STATE",
          reason: "Cannot schedule a fixed order",
        });
        continue;
      }
      if (order.status !== OrderStatus.PENDING) {
        violations.push({
          targetId: move.orderId,
          code: "INVALID_STATE",
          reason: `Cannot schedule order in status ${order.status}`,
        });
        continue;
      }
      orderId = order.id;
      qty = move.quantity ?? order.quantity;
      orderType = order.type;
      dueDate = order.dueDate;
      actionType = "SCHEDULE_PENDING";
      orderOriginalQtyMap.set(orderId, order.quantity);
    } else {
      continue;
    }

    // Deadline check
    const config = configMap.get(orderType);
    if (config) {
      const deadline = calculateOrderDeadline(new Date(dueDate), config);
      if (targetDate.getTime() > deadline.getTime()) {
        violations.push({
          targetId: move.assignmentId || move.orderId!,
          code: "DEADLINE_VIOLATION",
          reason: `Production date ${move.productionDate} is past the deadline`,
        });
        continue;
      }
    }

    const factory = factoryMap.get(move.factoryId);
    if (!factory) {
      violations.push({
        targetId: move.assignmentId || move.orderId!,
        code: "NOT_FOUND",
        reason: "Target factory not found",
      });
      continue;
    }

    // Add back capacity to old date if moving
    if (actionType === "MOVE_ASSIGNMENT" && oldFactoryId && oldDate) {
      const oldKey = `${oldFactoryId}_${oldDate.toISOString().split("T")[0]}`;
      const oldDelta = cumulativeCapacityDelta.get(oldKey) || 0;
      cumulativeCapacityDelta.set(oldKey, oldDelta + qty);
    }

    const currentDelta = cumulativeCapacityDelta.get(targetKey) || 0;
    cumulativeCapacityDelta.set(targetKey, currentDelta - qty);

    const movesIn = movesIntoSlot.get(targetKey) || [];
    movesIn.push(move.assignmentId || move.orderId!);
    movesIntoSlot.set(targetKey, movesIn);

    validActions.push({
      move,
      type: actionType,
      orderId,
      qty,
      orderType,
      dueDate,
      oldFactoryId,
      oldDate,
      oldCompletionDate,
    });
  }

  // Split-order validation: same orderId with multiple SCHEDULE_PENDING moves
  const pendingQtyByOrderId = new Map<
    string,
    { total: number; slots: Set<string> }
  >();
  for (const action of validActions) {
    if (action.type !== "SCHEDULE_PENDING") continue;
    const entry = pendingQtyByOrderId.get(action.orderId) ?? {
      total: 0,
      slots: new Set<string>(),
    };
    entry.total += action.qty;
    const slot = `${action.move.factoryId}_${action.move.productionDate}`;
    if (entry.slots.has(slot)) {
      violations.push({
        targetId: action.orderId,
        code: "INVALID_STATE",
        reason: `Duplicate slot ${action.move.factoryId} on ${action.move.productionDate} for the same order`,
      });
    }
    entry.slots.add(slot);
    pendingQtyByOrderId.set(action.orderId, entry);
  }
  for (const [orderId, entry] of pendingQtyByOrderId) {
    const originalQty = orderOriginalQtyMap.get(orderId) ?? 0;
    if (entry.total !== originalQty) {
      violations.push({
        targetId: orderId,
        code: "INVALID_STATE",
        reason: `Split quantities sum to ${entry.total} but order quantity is ${originalQty}`,
      });
    }
  }

  // Pass 2: Assert Net Capacity
  const targetKeys = Array.from(cumulativeCapacityDelta.keys());
  for (const key of targetKeys) {
    const delta = cumulativeCapacityDelta.get(key) || 0;
    // We only care if the net delta consumes capacity
    if (delta >= 0) continue;

    const [factoryId, dateStr] = key.split("_");
    const targetDate = toMidnight(dateStr);

    const currentCap = await findDailyCapacity(db, factoryId, targetDate);
    const factory = factoryMap.get(factoryId);
    if (!factory) continue;

    const baseCapacity = currentCap
      ? currentCap.curCapacity
      : factory.maxCapacity;
    const finalCapacity = baseCapacity + delta;

    if (finalCapacity < 0) {
      const responsibleTargetIds = movesIntoSlot.get(key) || [];
      for (const targetId of responsibleTargetIds) {
        violations.push({
          targetId,
          code: "CAPACITY_EXCEEDED",
          reason: `Insufficient capacity at factory ${factoryId} on ${dateStr}`,
        });
      }
    }
  }

  if (violations.length > 0) {
    throw new ManualEditValidationError(violations);
  }

  if (validActions.length === 0) {
    return { applied: 0 };
  }

  // 3. Execution
  const orderTypes = Array.from(new Set(validActions.map((a) => a.orderType)));

  await withScheduleLock(orderTypes, async () => {
    await db.$transaction(async (tx) => {
      const txDb = tx as unknown as PrismaClient;

      const ordersToUpdateStatus = new Set<string>();
      const ordersToUpdateModifiedBy = new Set<string>();
      const assignmentsToCreate: {
        orderId: string;
        factoryId: string;
        productionDate: Date;
        completionDate: Date;
        assignedQuantity: number;
        status: typeof AssignmentStatus.SCHEDULED;
      }[] = [];

      for (const action of validActions) {
        const newDate = toMidnight(action.move.productionDate);
        ordersToUpdateModifiedBy.add(action.orderId);

        if (action.type === "MOVE_ASSIGNMENT") {
          const timeDiff = newDate.getTime() - action.oldDate!.getTime();
          const newCompletionDate = new Date(
            action.oldCompletionDate!.getTime() + timeDiff,
          );

          await upsertDailyCapacityDelta(
            txDb,
            action.oldFactoryId!,
            action.oldDate!,
            action.qty,
            factoryMap.get(action.oldFactoryId!)?.maxCapacity || 0,
          );
          await upsertDailyCapacityDelta(
            txDb,
            action.move.factoryId,
            newDate,
            -action.qty,
            factoryMap.get(action.move.factoryId)?.maxCapacity || 0,
          );

          await updateAssignmentSlot(
            txDb,
            action.move.assignmentId!,
            action.move.factoryId,
            newDate,
            newCompletionDate,
          );
        } else {
          const config = configMap.get(action.orderType);
          const prodDays = config ? config.productionDays : 1;
          const completionDate = new Date(newDate);
          completionDate.setDate(completionDate.getDate() + prodDays);

          assignmentsToCreate.push({
            orderId: action.orderId,
            factoryId: action.move.factoryId,
            productionDate: newDate,
            completionDate,
            assignedQuantity: action.qty,
            status: AssignmentStatus.SCHEDULED,
          });

          ordersToUpdateStatus.add(action.orderId);
          await upsertDailyCapacityDelta(
            txDb,
            action.move.factoryId,
            newDate,
            -action.qty,
            factoryMap.get(action.move.factoryId)?.maxCapacity || 0,
          );
        }
      }

      if (assignmentsToCreate.length > 0) {
        await createAssignments(txDb, assignmentsToCreate);
      }

      if (ordersToUpdateStatus.size > 0) {
        await bulkUpdateOrderStatusAndModifiedBy(
          txDb,
          Array.from(ordersToUpdateStatus),
          OrderStatus.SCHEDULED,
          actorUserId,
        );
      }

      const ordersRemainingToTouch = Array.from(
        ordersToUpdateModifiedBy,
      ).filter((id) => !ordersToUpdateStatus.has(id));
      if (ordersRemainingToTouch.length > 0) {
        await bulkUpdateOrderModifiedBy(
          txDb,
          ordersRemainingToTouch,
          actorUserId,
        );
      }
    });
  });

  return { applied: validActions.length };
}
