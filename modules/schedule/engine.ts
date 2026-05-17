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
import { getTime } from "@/lib/get-time";
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

export async function runSchedule(type: string): Promise<ConflictOrderInfo[]> {
  const currentDate = await getTime();
  const orders = await findOrdersForScheduling(prisma, type);
  const factories = await findFactoriesWithCapacities(
    prisma,
    type,
    currentDate,
  );

  // In-memory reset: restore capacity used by SCHEDULED assignments.
  // Uses isSameLocalDay to handle UTC vs local-midnight date mismatches.
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

  if (strategyResult.conflictOrderIds.length === 0) return [];

  return fetchConflictOrders(prisma, strategyResult.conflictOrderIds);
}

// ---------------------------------------------------------------------------
// Conflict helpers
// ---------------------------------------------------------------------------

async function fetchConflictOrders(
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
