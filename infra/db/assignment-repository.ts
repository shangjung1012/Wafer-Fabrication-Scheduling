import type { PrismaClient } from "@/lib/generated/prisma";
import { AssignmentStatus } from "@/lib/generated/prisma";

export type CreateAssignmentInput = {
  orderId: string;
  factoryId: string;
  productionDate: Date;
  completionDate: Date;
  assignedQuantity: number;
  status: AssignmentStatus;
};

// pg driver caps bound parameters at 65,535; chunk large lists to stay within that limit.
const CHUNK_SIZE = 10_000;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size)
    chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function deleteScheduledAssignments(
  db: PrismaClient,
  orderIds: string[],
  startDate?: Date,
  endDate?: Date,
): Promise<void> {
  if (orderIds.length === 0) return;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (startDate) dateFilter.gte = startDate;
  if (endDate) dateFilter.lte = endDate;
  const dateCondition =
    Object.keys(dateFilter).length > 0 ? { productionDate: dateFilter } : {};

  for (const ids of chunk(orderIds, CHUNK_SIZE)) {
    await db.orderAssignment.deleteMany({
      where: {
        orderId: { in: ids },
        status: AssignmentStatus.SCHEDULED,
        ...dateCondition,
      },
    });
  }
}

export async function createAssignments(
  db: PrismaClient,
  assignments: CreateAssignmentInput[],
): Promise<void> {
  if (assignments.length === 0) return;
  for (const batch of chunk(assignments, CHUNK_SIZE)) {
    await db.orderAssignment.createMany({ data: batch });
  }
}

export async function findAssignmentsByIds(db: PrismaClient, ids: string[]) {
  if (ids.length === 0) return [];
  return db.orderAssignment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      orderId: true,
      factoryId: true,
      productionDate: true,
      completionDate: true,
      assignedQuantity: true,
      status: true,
      order: { select: { type: true, dueDate: true, isFixed: true } },
    },
  });
}

export async function updateAssignmentSlot(
  db: PrismaClient,
  id: string,
  factoryId: string,
  productionDate: Date,
  completionDate?: Date,
): Promise<void> {
  await db.orderAssignment.update({
    where: { id },
    data: {
      factoryId,
      productionDate,
      ...(completionDate ? { completionDate } : {}),
    },
  });
}
