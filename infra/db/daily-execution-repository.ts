import { prisma } from "@/lib/prisma";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma";

export async function getAffectedOrderTypes(
  currentDate: Date,
): Promise<string[]> {
  const affectedAssignments = await prisma.orderAssignment.findMany({
    where: {
      OR: [
        {
          status: AssignmentStatus.IN_PRODUCTION,
          completionDate: { lte: currentDate },
        },
        {
          status: AssignmentStatus.SCHEDULED,
          productionDate: { lte: currentDate },
        },
      ],
    },
    include: { order: { select: { type: true } } },
  });

  if (affectedAssignments.length === 0) return [];
  return Array.from(new Set(affectedAssignments.map((a) => a.order.type)));
}

export async function executeDailyStateAdvancement(
  currentDate: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Update IN_PRODUCTION -> COMPLETED
    const completedAssignments = await tx.orderAssignment.findMany({
      where: {
        status: AssignmentStatus.IN_PRODUCTION,
        completionDate: { lte: currentDate },
      },
    });
    if (completedAssignments.length > 0) {
      await tx.orderAssignment.updateMany({
        where: { id: { in: completedAssignments.map((a) => a.id) } },
        data: { status: AssignmentStatus.COMPLETED },
      });
    }

    // 2. Update SCHEDULED -> IN_PRODUCTION
    const inProductionAssignments = await tx.orderAssignment.findMany({
      where: {
        status: AssignmentStatus.SCHEDULED,
        productionDate: { lte: currentDate },
      },
    });
    if (inProductionAssignments.length > 0) {
      await tx.orderAssignment.updateMany({
        where: { id: { in: inProductionAssignments.map((a) => a.id) } },
        data: { status: AssignmentStatus.IN_PRODUCTION },
      });
    }

    // 3. Evaluate parent Orders
    const affectedOrderIds = Array.from(
      new Set([
        ...completedAssignments.map((a) => a.orderId),
        ...inProductionAssignments.map((a) => a.orderId),
      ]),
    );

    for (const orderId of affectedOrderIds) {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { assignments: true },
      });
      if (!order) continue;

      const allCompleted = order.assignments.every(
        (a) => a.status === AssignmentStatus.COMPLETED,
      );
      const anyInProductionOrCompleted = order.assignments.some(
        (a) =>
          a.status === AssignmentStatus.IN_PRODUCTION ||
          a.status === AssignmentStatus.COMPLETED,
      );

      if (allCompleted && order.status !== OrderStatus.COMPLETED) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.COMPLETED },
        });
      } else if (
        anyInProductionOrCompleted &&
        order.status === OrderStatus.SCHEDULED
      ) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.IN_PRODUCTION },
        });
      }
    }
  });
}
