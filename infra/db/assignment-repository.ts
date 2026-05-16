import type { PrismaClient } from "@/lib/generated/prisma";
import { AssignmentStatus } from "@/lib/generated/prisma";

export type CreateAssignmentInput = {
  orderId: string;
  factoryId: string;
  productionDate: Date;
  assignedQuantity: number;
  status: AssignmentStatus;
};

export async function deleteScheduledAssignments(
  db: PrismaClient,
  orderIds: string[],
): Promise<void> {
  if (orderIds.length === 0) return;
  await db.orderAssignment.deleteMany({
    where: {
      orderId: { in: orderIds },
      status: AssignmentStatus.SCHEDULED,
    },
  });
}

export async function createAssignments(
  db: PrismaClient,
  assignments: CreateAssignmentInput[],
): Promise<void> {
  if (assignments.length === 0) return;
  await db.orderAssignment.createMany({ data: assignments });
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
      assignedQuantity: true,
      status: true,
    },
  });
}

export async function updateAssignmentSlot(
  db: PrismaClient,
  id: string,
  factoryId: string,
  productionDate: Date,
): Promise<void> {
  await db.orderAssignment.update({
    where: { id },
    data: { factoryId, productionDate },
  });
}
