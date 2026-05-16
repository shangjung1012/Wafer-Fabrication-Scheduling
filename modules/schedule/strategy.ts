import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";
import { type SchedulingConfig } from "./config";

export type { SchedulingConfig };

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

export type ExistingCapacityDraft = CapacityDraft & {
  id: string;
};

export interface SchedulingAssignmentInput {
  status: AssignmentStatus;
  assignedQuantity: number;
  factoryId?: string;
  productionDate?: Date;
}

export interface SchedulingOrderInput {
  id: string;
  status: OrderStatus;
  dueDate: Date;
  quantity: number;
  createdAt: Date;
  assignments?: SchedulingAssignmentInput[];
}

export interface SchedulingFactoryInput {
  id: string;
  maxCapacity: number;
}

export type SchedulingCapacityInput = CapacityDraft;

export type ProcessedSchedulingOrder = SchedulingOrderInput & {
  status: OrderStatus;
};

export interface StrategyResult {
  processedOrders: ProcessedSchedulingOrder[];
  newAssignments: OrderAssignmentDraft[];
  updatedCapacities: ExistingCapacityDraft[];
  newCapacities: CapacityDraft[];
}

export interface IScheduleStrategy {
  name: string;
  execute(
    orders: SchedulingOrderInput[],
    factories: SchedulingFactoryInput[],
    capacities: SchedulingCapacityInput[],
    config: SchedulingConfig,
    currentDate?: Date,
  ): StrategyResult;
}

// Helper to get YYYY-MM-DD string robustly
function toDateString(d: Date | string): string {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const greedyBestFitStrategy: IScheduleStrategy = {
  name: "GREEDY_BEST_FIT",
  execute: (
    orders: SchedulingOrderInput[],
    factories: SchedulingFactoryInput[],
    capacities: SchedulingCapacityInput[],
    config: SchedulingConfig,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _currentDate: Date = new Date(),
  ): StrategyResult => {
    const result: StrategyResult = {
      processedOrders: [],
      newAssignments: [],
      updatedCapacities: [],
      newCapacities: [],
    };

    // 1. Sort orders (Layer 2 & IN_PRODUCTION Priority)
    const sortedOrders = [...orders].sort((a, b) => {
      // Priority 1: IN_PRODUCTION orders have absolute priority
      if (
        a.status === OrderStatus.IN_PRODUCTION &&
        b.status !== OrderStatus.IN_PRODUCTION
      )
        return -1;
      if (
        b.status === OrderStatus.IN_PRODUCTION &&
        a.status !== OrderStatus.IN_PRODUCTION
      )
        return 1;

      // Priority 2: PRIORITY_RETAIN policy prioritizes SCHEDULED orders
      if (config.reschedulePolicy === "PRIORITY_RETAIN") {
        if (
          a.status === OrderStatus.SCHEDULED &&
          b.status !== OrderStatus.SCHEDULED
        )
          return -1;
        if (
          b.status === OrderStatus.SCHEDULED &&
          a.status !== OrderStatus.SCHEDULED
        )
          return 1;
      }

      // Standard Priority: dueDate (asc) > quantity (desc) > createdAt (asc)
      const dueDateA = new Date(a.dueDate).getTime();
      const dueDateB = new Date(b.dueDate).getTime();
      if (dueDateA !== dueDateB) return dueDateA - dueDateB;

      if (a.quantity !== b.quantity) return b.quantity - a.quantity;

      const createdAtA = new Date(a.createdAt).getTime();
      const createdAtB = new Date(b.createdAt).getTime();
      return createdAtA - createdAtB;
    });

    // 2. Initialize in-memory capacity map
    const capacityMap = new Map<string, CapacityDraft>();
    for (const cap of capacities) {
      const dateKey = toDateString(cap.date);
      capacityMap.set(`${cap.factoryId}_${dateKey}`, { ...cap });
    }

    // 3. Process each order
    for (const order of sortedOrders) {
      const windowStart = new Date(config.startDate);
      windowStart.setDate(windowStart.getDate() + config.frozenDays);
      windowStart.setHours(0, 0, 0, 0);

      const windowEnd = new Date(order.dueDate);
      windowEnd.setDate(
        windowEnd.getDate() - config.bufferDays - (config.productionDays - 1),
      );
      if (config.endDate && windowEnd > config.endDate) {
        windowEnd.setTime(config.endDate.getTime());
      }
      windowEnd.setHours(23, 59, 59, 999);

      // Calculate remaining quantity excluding all current assignments
      // Engine leaves frozen or GAP_FILLING assignments in order.assignments
      let scheduledOrProducedQuantity = 0;
      for (const assignment of order.assignments || []) {
        scheduledOrProducedQuantity += assignment.assignedQuantity;
      }

      let remainingQty = order.quantity - scheduledOrProducedQuantity;
      const startingRemainingQty = remainingQty;

      // Mutation Ledger for rollback
      const rollbackLedger: {
        key: string;
        amountDeducted: number;
        wasCreated: boolean;
      }[] = [];

      const virtualAssignments: OrderAssignmentDraft[] = [];

      // Only attempt scheduling if window is valid and we have things to schedule
      if (windowStart.getTime() <= windowEnd.getTime() && remainingQty > 0) {
        if (config.splittable) {
          // Splittable logic: Allocate day-by-day, factory-by-factory
          const currentIterDate = new Date(windowStart);

          while (
            currentIterDate.getTime() <= windowEnd.getTime() &&
            remainingQty > 0
          ) {
            const dateKey = toDateString(currentIterDate);

            // Get factories and their capacities for this date
            const availableFactoriesForDate = factories.map((factory) => {
              const mapKey = `${factory.id}_${dateKey}`;
              let cap = capacityMap.get(mapKey);

              // Dynamic Capacity Creation
              if (!cap) {
                cap = {
                  factoryId: factory.id,
                  date: new Date(currentIterDate),
                  maxCapacity: factory.maxCapacity,
                  curCapacity: factory.maxCapacity,
                };
                capacityMap.set(mapKey, cap);
                rollbackLedger.push({
                  key: mapKey,
                  amountDeducted: 0,
                  wasCreated: true,
                });
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
              const mapKey = `${cap.factoryId}_${dateKey}`;
              rollbackLedger.push({
                key: mapKey,
                amountDeducted: allocated,
                wasCreated: false,
              });

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
        } else {
          // Non-splittable logic: Find a single block that fits the entire remainingQty
          let foundSingleBlock = false;
          const currentIterDate = new Date(windowStart);

          while (
            currentIterDate.getTime() <= windowEnd.getTime() &&
            !foundSingleBlock
          ) {
            const dateKey = toDateString(currentIterDate);

            for (const factory of factories) {
              const mapKey = `${factory.id}_${dateKey}`;
              let cap = capacityMap.get(mapKey);

              // Simulate capacity if not exists
              const curCapacity = cap ? cap.curCapacity : factory.maxCapacity;

              if (curCapacity >= remainingQty) {
                // Found a fit!
                foundSingleBlock = true;

                if (!cap) {
                  cap = {
                    factoryId: factory.id,
                    date: new Date(currentIterDate),
                    maxCapacity: factory.maxCapacity,
                    curCapacity: factory.maxCapacity,
                  };
                  capacityMap.set(mapKey, cap);
                  rollbackLedger.push({
                    key: mapKey,
                    amountDeducted: 0,
                    wasCreated: true,
                  });
                }

                // Allocate everything
                cap.curCapacity -= remainingQty;
                rollbackLedger.push({
                  key: mapKey,
                  amountDeducted: remainingQty,
                  wasCreated: false,
                });

                virtualAssignments.push({
                  orderId: order.id,
                  factoryId: cap.factoryId,
                  productionDate: new Date(currentIterDate),
                  assignedQuantity: remainingQty,
                  status: AssignmentStatus.SCHEDULED,
                });

                remainingQty = 0;
                break; // Break inner factory loop
              }
            }
            currentIterDate.setDate(currentIterDate.getDate() + 1);
          }
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
        // Failure: Rollback using the ledger, drop virtual assignments
        for (let i = rollbackLedger.length - 1; i >= 0; i--) {
          const entry = rollbackLedger[i];
          if (entry.wasCreated) {
            capacityMap.delete(entry.key);
          } else {
            const restoredCap = capacityMap.get(entry.key);
            if (restoredCap) {
              restoredCap.curCapacity += entry.amountDeducted;
            }
          }
        }

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
          result.updatedCapacities.push({ ...cap, id: cap.id });
        }
      } else {
        // Dynamically created capacity that survived rollbacks
        result.newCapacities.push({ ...cap });
      }
    }

    return result;
  },
};
