import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";

export const SchedulingConfig = {
  // Days locked before an order can enter IN_PRODUCTION.
  frozenDays: 0,
  // Days required to complete production (IN_PRODUCTION -> COMPLETED).
  productionDays: 1,
  // Safety buffer days required between COMPLETION and the dueDate.
  bufferDays: 0,
};

export interface OrderAssignmentDraft {
  orderId: string;
  factoryId: string;
  productionDate: Date;
  assignedQuantity: number;
  status: typeof AssignmentStatus.SCHEDULED;
}

export interface CapacityDraft {
  id?: string;
  factoryId: string;
  date: Date;
  maxCapacity: number;
  curCapacity: number;
}

export interface StrategyResult {
  processedOrders: any[];
  newAssignments: OrderAssignmentDraft[];
  updatedCapacities: CapacityDraft[];
  newCapacities: CapacityDraft[];
}

// Helper to get YYYY-MM-DD string robustly
function toDateString(d: Date | string): string {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function greedyBestFitStrategy(
  orders: any[],
  factories: any[],
  capacities: any[],
  currentDate: Date = new Date(),
): StrategyResult {
  const result: StrategyResult = {
    processedOrders: [],
    newAssignments: [],
    updatedCapacities: [],
    newCapacities: [],
  };

  // 1. Sort orders: dueDate (asc) > quantity (desc) > createdAt (asc)
  const sortedOrders = [...orders].sort((a, b) => {
    const dueDateA = new Date(a.dueDate).getTime();
    const dueDateB = new Date(b.dueDate).getTime();
    if (dueDateA !== dueDateB) return dueDateA - dueDateB;

    if (a.quantity !== b.quantity) return b.quantity - a.quantity;

    const createdAtA = new Date(a.createdAt).getTime();
    const createdAtB = new Date(b.createdAt).getTime();
    return createdAtA - createdAtB;
  });

  // 2. Initialize in-memory capacity map
  let capacityMap = new Map<string, CapacityDraft>();
  for (const cap of capacities) {
    const dateKey = toDateString(cap.date);
    capacityMap.set(`${cap.factoryId}_${dateKey}`, { ...cap });
  }

  // 3. Process each order
  for (const order of sortedOrders) {
    const windowStart = new Date(currentDate);
    windowStart.setDate(
      windowStart.getDate() + 1 + SchedulingConfig.frozenDays,
    );
    windowStart.setHours(0, 0, 0, 0);

    const windowEnd = new Date(order.dueDate);
    windowEnd.setDate(
      windowEnd.getDate() -
        SchedulingConfig.bufferDays -
        (SchedulingConfig.productionDays - 1),
    );
    windowEnd.setHours(23, 59, 59, 999);

    // Calculate remaining quantity excluding already producing/completed parts
    let scheduledOrProducedQuantity = 0;
    for (const assignment of order.assignments || []) {
      if (
        assignment.status === AssignmentStatus.IN_PRODUCTION ||
        assignment.status === AssignmentStatus.COMPLETED
      ) {
        scheduledOrProducedQuantity += assignment.assignedQuantity;
      }
    }

    let remainingQty = order.quantity - scheduledOrProducedQuantity;
    const startingRemainingQty = remainingQty;

    // Snapshot capacities before trial
    const capacitySnapshot = new Map<string, CapacityDraft>();
    for (const [k, v] of capacityMap.entries()) {
      capacitySnapshot.set(k, { ...v, date: new Date(v.date) });
    }

    const virtualAssignments: OrderAssignmentDraft[] = [];

    // Only attempt scheduling if window is valid and we have things to schedule
    if (windowStart.getTime() <= windowEnd.getTime() && remainingQty > 0) {
      let currentIterDate = new Date(windowStart);

      while (
        currentIterDate.getTime() <= windowEnd.getTime() &&
        remainingQty > 0
      ) {
        const dateKey = toDateString(currentIterDate);

        // Get factories and their capacities for this date
        const availableFactoriesForDate = factories.map((factory) => {
          const mapKey = `${factory.id}_${dateKey}`;
          let cap = capacityMap.get(mapKey);

          // Dynamic Capacity Creation (will be rolled back if snapshot restored)
          if (!cap) {
            cap = {
              factoryId: factory.id,
              date: new Date(currentIterDate),
              maxCapacity: factory.maxCapacity,
              curCapacity: factory.maxCapacity,
            };
            capacityMap.set(mapKey, cap);
          }
          return cap;
        });

        // Sort factories by curCapacity (descending) for Best-Fit
        availableFactoriesForDate.sort((a, b) => {
          if (b.curCapacity !== a.curCapacity) {
            return b.curCapacity - a.curCapacity;
          }
          return a.factoryId.localeCompare(b.factoryId);
        });

        // Allocate capacity
        for (const cap of availableFactoriesForDate) {
          if (remainingQty <= 0) break;
          if (cap.curCapacity <= 0) continue;

          const allocated = Math.min(remainingQty, cap.curCapacity);

          // Deduct from mapped capacity
          cap.curCapacity -= allocated;

          virtualAssignments.push({
            orderId: order.id,
            factoryId: cap.factoryId,
            productionDate: new Date(currentIterDate),
            assignedQuantity: allocated,
            status: AssignmentStatus.SCHEDULED,
          });

          remainingQty -= allocated;
        }

        currentIterDate.setDate(currentIterDate.getDate() + 1);
      }
    }

    // 4. Evaluate Success or Failure
    if (remainingQty <= 0) {
      // Success: Keep mutated capacityMap, save assignments
      if (startingRemainingQty > 0) {
        result.newAssignments.push(...virtualAssignments);
      }

      let finalStatus = order.status;
      // If order was already fully scheduled previously, its remainingQty is 0 and startingRemainingQty is 0
      if (
        order.status !== OrderStatus.IN_PRODUCTION &&
        order.status !== OrderStatus.COMPLETED &&
        startingRemainingQty > 0
      ) {
        finalStatus = OrderStatus.SCHEDULED;
      }
      result.processedOrders.push({ ...order, status: finalStatus });
    } else {
      // Failure: Restore capacity map snapshot, drop virtual assignments
      capacityMap = capacitySnapshot;

      let finalStatus = order.status;
      if (
        order.status !== OrderStatus.IN_PRODUCTION &&
        order.status !== OrderStatus.COMPLETED
      ) {
        finalStatus = OrderStatus.APPROVED;
      }
      result.processedOrders.push({ ...order, status: finalStatus });
    }
  }

  // 5. Finalize output arrays from the final state of capacityMap
  for (const cap of Array.from(capacityMap.values())) {
    if (cap.id) {
      const originalCap = capacities.find((c) => c.id === cap.id);
      if (originalCap && originalCap.curCapacity !== cap.curCapacity) {
        result.updatedCapacities.push({ ...cap });
      }
    } else {
      // Dynamically created capacity that survived rollbacks
      result.newCapacities.push({ ...cap });
    }
  }

  return result;
}
