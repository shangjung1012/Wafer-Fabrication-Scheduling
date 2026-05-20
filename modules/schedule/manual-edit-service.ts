import type { PrismaClient } from "@/lib/generated/prisma";
import { AssignmentStatus } from "@/lib/generated/prisma";
import {
  findAssignmentsByIds,
  updateAssignmentSlot,
} from "@/infra/db/assignment-repository";
import { upsertDailyCapacityDelta } from "@/infra/db/capacity-repository";
import { withScheduleLock } from "@/infra/redis/schedule-store";

export type AssignmentMove = {
  assignmentId: string;
  factoryId: string;
  productionDate: string; // YYYY-MM-DD
};

export type AssignmentMoveError = {
  assignmentId: string;
  reason: string;
};

export type AssignmentMoveResult = {
  applied: number;
  errors: AssignmentMoveError[];
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
    return { applied: 0, errors: [] };
  }

  const assignments = await findAssignmentsByIds(
    db,
    moves.map((m) => m.assignmentId),
  );
  const assignmentMap = new Map(assignments.map((a) => [a.id, a]));

  const errors: AssignmentMoveError[] = [];
  const validMoves: {
    move: AssignmentMove;
    assignment: (typeof assignments)[number];
  }[] = [];

  for (const move of moves) {
    const existing = assignmentMap.get(move.assignmentId);
    if (!existing) {
      errors.push({
        assignmentId: move.assignmentId,
        reason: "Assignment not found",
      });
      continue;
    }
    if (existing.status !== AssignmentStatus.SCHEDULED) {
      errors.push({
        assignmentId: move.assignmentId,
        reason: `Cannot move assignment in status ${existing.status}`,
      });
      continue;
    }
    validMoves.push({ move, assignment: existing });
  }

  if (validMoves.length === 0) {
    return { applied: 0, errors };
  }

  // Build factoryId → maxCapacity lookup for any factories we'll touch
  const factoryIds = new Set<string>();
  for (const { move, assignment } of validMoves) {
    factoryIds.add(move.factoryId);
    factoryIds.add(assignment.factoryId);
  }
  const factories = await db.factory.findMany({
    where: { id: { in: Array.from(factoryIds) } },
    select: { id: true, maxCapacity: true },
  });
  const factoryMaxById = new Map(factories.map((f) => [f.id, f.maxCapacity]));

  const orderIdsTouched = new Set<string>();

  const types = Array.from(
    new Set(validMoves.map((v) => (v.assignment as any).order.type)),
  );

  await withScheduleLock(types, async () => {
    await db.$transaction(async (tx) => {
      const txDb = tx as unknown as PrismaClient;
      for (const { move, assignment } of validMoves) {
        const oldDate = new Date(assignment.productionDate);
        const newDate = toMidnight(move.productionDate);
        const sameSlot =
          assignment.factoryId === move.factoryId &&
          oldDate.getTime() === newDate.getTime();
        if (sameSlot) continue;

        const qty = assignment.assignedQuantity;

        await upsertDailyCapacityDelta(
          txDb,
          assignment.factoryId,
          oldDate,
          +qty,
          factoryMaxById.get(assignment.factoryId) ?? 0,
        );
        await upsertDailyCapacityDelta(
          txDb,
          move.factoryId,
          newDate,
          -qty,
          factoryMaxById.get(move.factoryId) ?? 0,
        );

        await updateAssignmentSlot(
          txDb,
          move.assignmentId,
          move.factoryId,
          newDate,
        );
        orderIdsTouched.add(assignment.orderId);
      }

      if (orderIdsTouched.size > 0) {
        await txDb.order.updateMany({
          where: { id: { in: Array.from(orderIdsTouched) } },
          data: { lastModifiedById: actorUserId },
        });
      }
    });
  });

  return { applied: validMoves.length, errors };
}
