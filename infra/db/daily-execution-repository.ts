import { prisma } from "@/lib/prisma";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma";

export async function getAffectedOrderTypes(
  currentDate: Date,
): Promise<string[]> {
  const affectedOrders = await prisma.order.findMany({
    where: {
      assignments: {
        some: {
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
      },
    },
    select: { type: true },
    distinct: ["type"],
  });

  return affectedOrders.map((o) => o.type);
}

export async function executeDailyStateAdvancement(
  currentDate: Date,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // 1. Fetch assignments to update with minimal payload
    const assignmentsToComplete = await tx.orderAssignment.findMany({
      where: {
        status: AssignmentStatus.IN_PRODUCTION,
        completionDate: { lte: currentDate },
      },
      select: { id: true, orderId: true },
    });

    const assignmentsToStart = await tx.orderAssignment.findMany({
      where: {
        status: AssignmentStatus.SCHEDULED,
        productionDate: { lte: currentDate },
      },
      select: { id: true, orderId: true },
    });

    // 2. Batch update assignments
    if (assignmentsToComplete.length > 0) {
      await tx.orderAssignment.updateMany({
        where: { id: { in: assignmentsToComplete.map((a) => a.id) } },
        data: { status: AssignmentStatus.COMPLETED },
      });
    }

    if (assignmentsToStart.length > 0) {
      await tx.orderAssignment.updateMany({
        where: { id: { in: assignmentsToStart.map((a) => a.id) } },
        data: { status: AssignmentStatus.IN_PRODUCTION },
      });
    }

    // 3. Efficiently evaluate and batch update parent Orders
    const affectedOrderIds = Array.from(
      new Set([
        ...assignmentsToComplete.map((a) => a.orderId),
        ...assignmentsToStart.map((a) => a.orderId),
      ]),
    );

    if (affectedOrderIds.length === 0) return;

    const affectedOrders = await tx.order.findMany({
      where: { id: { in: affectedOrderIds } },
      select: {
        id: true,
        status: true,
        assignments: { select: { status: true } },
      },
    });

    const orderIdsToComplete: string[] = [];
    const orderIdsToStart: string[] = [];

    for (const order of affectedOrders) {
      const allCompleted = order.assignments.every(
        (a) => a.status === AssignmentStatus.COMPLETED,
      );
      const anyInProductionOrCompleted = order.assignments.some(
        (a) =>
          a.status === AssignmentStatus.IN_PRODUCTION ||
          a.status === AssignmentStatus.COMPLETED,
      );

      if (allCompleted && order.status !== OrderStatus.COMPLETED) {
        orderIdsToComplete.push(order.id);
      } else if (
        anyInProductionOrCompleted &&
        order.status === OrderStatus.SCHEDULED
      ) {
        orderIdsToStart.push(order.id);
      }
    }

    if (orderIdsToComplete.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: orderIdsToComplete } },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    if (orderIdsToStart.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: orderIdsToStart } },
        data: { status: OrderStatus.IN_PRODUCTION },
      });
    }
  });
}
