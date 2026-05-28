import { prisma } from "@/lib/prisma";
import {
  OrderStatus,
  AssignmentStatus,
  PrismaClient,
} from "@/lib/generated/prisma";
import { upsertSystemState } from "@/infra/db/system-state-repository";

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
  patch?: { isSimulationMode?: boolean; simulationDate?: Date | null },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (patch) {
      await upsertSystemState(tx as unknown as PrismaClient, patch);
    }

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

export async function revertSimulationStatuses(
  realToday: Date,
  patch?: { isSimulationMode?: boolean; simulationDate?: Date | null },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (patch) {
      await upsertSystemState(tx as unknown as PrismaClient, patch);
    }

    // 1. Find assignments advanced beyond real today
    const toRevertToInProduction = await tx.orderAssignment.findMany({
      where: {
        status: AssignmentStatus.COMPLETED,
        completionDate: { gt: realToday },
      },
      select: { id: true, orderId: true },
    });

    const toRevertToScheduled = await tx.orderAssignment.findMany({
      where: {
        status: AssignmentStatus.IN_PRODUCTION,
        productionDate: { gt: realToday },
      },
      select: { id: true, orderId: true },
    });

    // 2. Batch revert assignment statuses
    if (toRevertToInProduction.length > 0) {
      await tx.orderAssignment.updateMany({
        where: { id: { in: toRevertToInProduction.map((a) => a.id) } },
        data: { status: AssignmentStatus.IN_PRODUCTION },
      });
    }

    if (toRevertToScheduled.length > 0) {
      await tx.orderAssignment.updateMany({
        where: { id: { in: toRevertToScheduled.map((a) => a.id) } },
        data: { status: AssignmentStatus.SCHEDULED },
      });
    }

    // 3. Re-evaluate parent Order statuses
    const affectedOrderIds = Array.from(
      new Set([
        ...toRevertToInProduction.map((a) => a.orderId),
        ...toRevertToScheduled.map((a) => a.orderId),
      ]),
    );

    if (affectedOrderIds.length === 0) return;

    // Re-read orders — reads within the same transaction reflect the updates above
    const affectedOrders = await tx.order.findMany({
      where: { id: { in: affectedOrderIds } },
      select: {
        id: true,
        status: true,
        assignments: { select: { status: true } },
      },
    });

    const toSetCompleted: string[] = [];
    const toSetInProduction: string[] = [];
    const toSetScheduled: string[] = [];

    for (const order of affectedOrders) {
      const allCompleted = order.assignments.every(
        (a) => a.status === AssignmentStatus.COMPLETED,
      );
      const anyActive = order.assignments.some(
        (a) =>
          a.status === AssignmentStatus.IN_PRODUCTION ||
          a.status === AssignmentStatus.COMPLETED,
      );

      if (allCompleted && order.status !== OrderStatus.COMPLETED) {
        toSetCompleted.push(order.id);
      } else if (
        anyActive &&
        !allCompleted &&
        order.status !== OrderStatus.IN_PRODUCTION
      ) {
        toSetInProduction.push(order.id);
      } else if (!anyActive && order.status !== OrderStatus.SCHEDULED) {
        toSetScheduled.push(order.id);
      }
    }

    if (toSetCompleted.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: toSetCompleted } },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    if (toSetInProduction.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: toSetInProduction } },
        data: { status: OrderStatus.IN_PRODUCTION },
      });
    }

    if (toSetScheduled.length > 0) {
      await tx.order.updateMany({
        where: { id: { in: toSetScheduled } },
        data: { status: OrderStatus.SCHEDULED },
      });
    }
  });
}
