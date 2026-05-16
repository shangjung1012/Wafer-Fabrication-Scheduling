import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@/lib/generated/prisma";
import type {
  SchedulingCapacityInput,
  SchedulingOrderInput,
  StrategyResult,
} from "@/modules/schedule/strategy";
import {
  resolveAlgorithm,
  type SchedulingAlgorithmId,
} from "@/modules/schedule/algorithms";
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
import { format } from "date-fns";

export type ConflictOrderInfo = {
  id: string;
  name: string;
  quantity: number;
  dueDate: string; // YYYY-MM-DD
  applicantEmail: string | null;
  applicantUsername: string | null;
  adminEmail: string | null;
  adminUsername: string | null;
};

// Compare two dates by their LOCAL calendar day, ignoring timezone offset.
// Needed because seed records use UTC midnight while the scheduling engine
// uses local midnight — the same day but different getTime() values.
function isSameLocalDay(a: Date | string, b: Date | string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export type PreviousScheduledAssignment = {
  orderId: string;
  factoryId: string;
  productionDate: Date;
  assignedQuantity: number;
};

export type SimulationResult = {
  strategy: StrategyResult;
  orders: SchedulingOrderInput[];
  capacitiesBefore: SchedulingCapacityInput[];
  previousScheduled: PreviousScheduledAssignment[];
};

export async function simulateSchedule(
  type: string,
  algorithmId?: SchedulingAlgorithmId | string,
): Promise<SimulationResult> {
  const orders = await findOrdersForScheduling(prisma, type);
  const factories = await findFactoriesWithCapacities(prisma, type);

  // In-memory reset: restore capacity used by SCHEDULED assignments.
  // Uses isSameLocalDay to handle UTC vs local-midnight date mismatches.
  const capacitiesBefore: SchedulingCapacityInput[] = [];
  for (const factory of factories) {
    if (factory.dailyCapacities) {
      capacitiesBefore.push(...factory.dailyCapacities.map((c) => ({ ...c })));
    }
  }
  const capacities = capacitiesBefore.map((c) => ({ ...c }));

  const previousScheduled: PreviousScheduledAssignment[] = [];

  for (const order of orders) {
    if (order.assignments) {
      const remainingAssignments = [];
      for (const assignment of order.assignments) {
        if (assignment.status === AssignmentStatus.SCHEDULED) {
          previousScheduled.push({
            orderId: order.id,
            factoryId: assignment.factoryId!,
            productionDate: new Date(assignment.productionDate!),
            assignedQuantity: assignment.assignedQuantity,
          });
          const cap = capacities.find(
            (c) =>
              c.factoryId === assignment.factoryId &&
              isSameLocalDay(c.date, assignment.productionDate),
          );
          if (cap) cap.curCapacity += assignment.assignedQuantity;
        } else {
          remainingAssignments.push(assignment);
        }
      }
      order.assignments = remainingAssignments;
    }
  }

  const algorithm = resolveAlgorithm(algorithmId);
  const currentDate = new Date();
  const strategy = algorithm.run(orders, factories, capacities, currentDate);

  return { strategy, orders, capacitiesBefore, previousScheduled };
}

export async function runSchedule(
  type: string,
  algorithmId?: SchedulingAlgorithmId | string,
): Promise<ConflictOrderInfo[]> {
  const { strategy } = await simulateSchedule(type, algorithmId);
  const processedOrderIds = strategy.processedOrders.map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    const db = tx as unknown as PrismaClient;

    await deleteScheduledAssignments(db, processedOrderIds);

    await bulkUpdateOrderStatus(
      db,
      strategy.processedOrders.map((o) => ({
        id: o.id,
        status: o.status,
      })),
    );

    await createDailyCapacities(db, strategy.newCapacities);

    for (const cap of strategy.updatedCapacities) {
      await updateDailyCapacityById(db, cap.id, cap.curCapacity);
    }

    await createAssignments(db, strategy.newAssignments);
  });

  if (strategy.conflictOrderIds.length === 0) return [];

  return fetchConflictOrders(prisma, strategy.conflictOrderIds);
}

// ---------------------------------------------------------------------------
// Conflict helpers
// ---------------------------------------------------------------------------

export async function fetchConflictOrders(
  db: PrismaClient,
  ids: string[],
): Promise<ConflictOrderInfo[]> {
  const rows = await db.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      quantity: true,
      dueDate: true,
      applicant: { select: { email: true, username: true } },
      lastModifiedBy: { select: { email: true, username: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    dueDate: format(r.dueDate, "yyyy-MM-dd"),
    applicantEmail: r.applicant?.email ?? null,
    applicantUsername: r.applicant?.username ?? null,
    adminEmail: r.lastModifiedBy?.email ?? null,
    adminUsername: r.lastModifiedBy?.username ?? null,
  }));
}
