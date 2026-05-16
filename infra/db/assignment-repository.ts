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
  startDate?: Date,
  endDate?: Date,
): Promise<void> {
  if (orderIds.length === 0) return;

  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (startDate) dateFilter.gte = startDate;
  if (endDate) dateFilter.lte = endDate;

  await db.orderAssignment.deleteMany({
    where: {
      orderId: { in: orderIds },
      status: AssignmentStatus.SCHEDULED,
      ...(Object.keys(dateFilter).length > 0
        ? { productionDate: dateFilter }
        : {}),
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
