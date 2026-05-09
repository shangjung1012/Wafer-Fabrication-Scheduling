import { prisma } from "@/lib/prisma";
import { greedyBestFitStrategy } from "@/modules/schedule/strategy";
import { findOrdersForScheduling } from "@/infra/db/order-repository";
import { findFactoriesWithCapacities } from "@/infra/db/factory-repository";
import { AssignmentStatus } from "@/lib/generated/prisma/client";

export async function runSchedule(type: string): Promise<void> {
  const orders = await findOrdersForScheduling(prisma, type);
  const factories = await findFactoriesWithCapacities(prisma, type);

  // In-Memory Reset:
  const capacities: any[] = [];
  for (const factory of factories) {
    if (factory.dailyCapacities) {
      capacities.push(...factory.dailyCapacities);
    }
  }

  for (const order of orders) {
    if (order.assignments) {
      // Filter out assignments that are SCHEDULED and put their capacity back
      const remainingAssignments = [];
      for (const assignment of order.assignments) {
        if (assignment.status === AssignmentStatus.SCHEDULED) {
          // Add the assignedQuantity back to the corresponding in-memory DailyCapacity.curCapacity
          const cap = capacities.find(
            (c) =>
              c.factoryId === assignment.factoryId &&
              new Date(c.date).getTime() ===
                new Date(assignment.productionDate).getTime(),
          );
          if (cap) {
            cap.curCapacity += assignment.assignedQuantity;
          }
        } else {
          remainingAssignments.push(assignment);
        }
      }
      order.assignments = remainingAssignments;
    }
  }

  const currentDate = new Date();
  const strategyResult = greedyBestFitStrategy(
    orders,
    factories,
    capacities,
    currentDate,
  );

  const processedOrderIds = strategyResult.processedOrders.map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    // 1. Delete Old Assignments
    if (processedOrderIds.length > 0) {
      await tx.orderAssignment.deleteMany({
        where: {
          orderId: { in: processedOrderIds },
          status: AssignmentStatus.SCHEDULED,
        },
      });
    }

    // 2. Update Orders
    for (const order of strategyResult.processedOrders) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: order.status },
      });
    }

    // 3. Insert New Capacities
    if (strategyResult.newCapacities.length > 0) {
      await tx.dailyCapacity.createMany({
        data: strategyResult.newCapacities,
        skipDuplicates: true,
      });
    }

    // 4. Update Existing Capacities
    for (const cap of strategyResult.updatedCapacities) {
      await tx.dailyCapacity.update({
        where: { id: cap.id },
        data: { curCapacity: cap.curCapacity },
      });
    }

    // 5. Insert New Assignments
    if (strategyResult.newAssignments.length > 0) {
      await tx.orderAssignment.createMany({
        data: strategyResult.newAssignments,
      });
    }
  });
}
