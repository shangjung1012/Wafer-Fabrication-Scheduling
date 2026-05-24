import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";
import { type SchedulingConfig } from "./config";
import { calculateOrderDeadline } from "./validation-utils";

export type { SchedulingConfig };

export interface OrderAssignmentDraft {
  orderId: string;
  factoryId: string;
  productionDate: Date;
  completionDate: Date;
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
  isFixed: boolean;
  isPrioritized: boolean;
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
    dbCapacities?: SchedulingCapacityInput[],
  ): StrategyResult;
}

// Helper to get YYYY-MM-DD string robustly
function toDateString(d: Date | string): string {
  const date = new Date(d);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Helper to compute the total available capacity across all factories within
// the [windowStart, windowEnd] inclusive date window. For each (factory, day):
//   - If a CapacityDraft exists in capacityMap, use max(0, curCapacity).
//   - Otherwise, fall back to factory.maxCapacity (dynamic capacity baseline).
// Used to detect "hard conflicts" — orders whose remaining quantity exceeds
// the total schedulable capacity within their due-date window, meaning no
// future rerun can resolve them.
export function computeTotalAvailableCapacity(
  windowStart: Date,
  windowEnd: Date,
  factories: SchedulingFactoryInput[],
  capacityMap: Map<string, CapacityDraft>,
): number {
  let total = 0;
  const iterDate = new Date(
    Date.UTC(
      windowStart.getUTCFullYear(),
      windowStart.getUTCMonth(),
      windowStart.getUTCDate(),
    ),
  );
  const endTime = windowEnd.getTime();

  while (iterDate.getTime() <= endTime) {
    const dateKey = toDateString(iterDate);
    for (const factory of factories) {
      const mapKey = `${factory.id}_${dateKey}`;
      const cap = capacityMap.get(mapKey);
      if (cap) {
        total += Math.max(0, cap.curCapacity);
      } else {
        total += factory.maxCapacity;
      }
    }
    iterDate.setUTCDate(iterDate.getUTCDate() + 1);
  }

  return total;
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
    dbCapacities?: SchedulingCapacityInput[],
  ): StrategyResult => {
    const result: StrategyResult = {
      processedOrders: [],
      newAssignments: [],
      updatedCapacities: [],
      newCapacities: [],
    };

    // 1. Separate immutable and mutable orders
    const immutableOrders: SchedulingOrderInput[] = [];
    const mutableOrders: SchedulingOrderInput[] = [];

    for (const order of orders) {
      const isImmutable =
        order.isFixed ||
        order.status === OrderStatus.IN_PRODUCTION ||
        order.status === OrderStatus.COMPLETED;
      if (isImmutable) {
        immutableOrders.push(order);
      } else {
        mutableOrders.push(order);
      }
    }

    // 2. Initialize in-memory capacity map
    const capacityMap = new Map<string, CapacityDraft>();
    for (const cap of capacities) {
      const dateKey = toDateString(cap.date);
      capacityMap.set(`${cap.factoryId}_${dateKey}`, { ...cap });
    }

    // 3. Pre-allocate capacity for immutable orders and push to processedOrders
    for (const order of immutableOrders) {
      for (const assignment of order.assignments || []) {
        if (!assignment.productionDate || !assignment.factoryId) continue;

        const dateKey = toDateString(assignment.productionDate);
        const mapKey = `${assignment.factoryId}_${dateKey}`;
        let cap = capacityMap.get(mapKey);

        if (!cap) {
          const factory = factories.find((f) => f.id === assignment.factoryId);
          const maxCap = factory ? factory.maxCapacity : 10000; // Fallback
          cap = {
            factoryId: assignment.factoryId,
            date: new Date(assignment.productionDate),
            maxCapacity: maxCap,
            curCapacity: maxCap,
          };
          capacityMap.set(mapKey, cap);
        }

        // Only deduct if this capacity draft was dynamically created in this run
        // (i.e., it doesn't have an ID from the database).
        // If it has an ID, the database already reflects this assignment's deduction.
        if (!cap.id) {
          cap.curCapacity -= assignment.assignedQuantity;
        }
      }
      result.processedOrders.push({ ...order, status: order.status });
    }

    // 4. Sort mutable orders
    const sortedOrders = [...mutableOrders].sort((a, b) => {
      // Priority 1: isPrioritized orders
      if (a.isPrioritized && !b.isPrioritized) return -1;
      if (!a.isPrioritized && b.isPrioritized) return 1;

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

    // 5. Process each mutable order
    for (const order of sortedOrders) {
      const windowStart = new Date(
        Date.UTC(
          new Date(config.startDate).getUTCFullYear(),
          new Date(config.startDate).getUTCMonth(),
          new Date(config.startDate).getUTCDate(),
        ),
      );

      const windowEnd = calculateOrderDeadline(new Date(order.dueDate), config);

      if (config.endDate) {
        const configEnd = new Date(
          Date.UTC(
            new Date(config.endDate).getUTCFullYear(),
            new Date(config.endDate).getUTCMonth(),
            new Date(config.endDate).getUTCDate(),
          ),
        );
        if (windowEnd.getTime() > configEnd.getTime()) {
          windowEnd.setTime(configEnd.getTime());
        }
      }

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

              const completionDate = new Date(currentIterDate);
              completionDate.setDate(
                completionDate.getDate() + config.productionDays,
              );

              virtualAssignments.push({
                orderId: order.id,
                factoryId: cap.factoryId,
                productionDate: new Date(currentIterDate),
                completionDate: completionDate,
                assignedQuantity: allocated,
                status: AssignmentStatus.SCHEDULED,
              });

              remainingQty -= allocated;
            }

            currentIterDate.setUTCDate(currentIterDate.getUTCDate() + 1);
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

                const completionDate = new Date(currentIterDate);
                completionDate.setDate(
                  completionDate.getDate() + config.productionDays,
                );

                virtualAssignments.push({
                  orderId: order.id,
                  factoryId: cap.factoryId,
                  productionDate: new Date(currentIterDate),
                  completionDate: completionDate,
                  assignedQuantity: remainingQty,
                  status: AssignmentStatus.SCHEDULED,
                });

                remainingQty = 0;
                break; // Break inner factory loop
              }
            }
            currentIterDate.setUTCDate(currentIterDate.getUTCDate() + 1);
          }
        }
      }

      // 4. Evaluate Success or Failure
      if (remainingQty <= 0) {
        // Success: Keep mutated capacityMap, save assignments
        if (startingRemainingQty > 0) {
          result.newAssignments.push(...virtualAssignments);
        }

        // Mutable order that succeeded becomes SCHEDULED
        let finalStatus = order.status;
        if (startingRemainingQty > 0) {
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

        // Mutable order that failed becomes FAILED
        result.processedOrders.push({ ...order, status: OrderStatus.FAILED });
      }
    }

    // 5. Finalize output arrays from the final state of capacityMap
    for (const cap of Array.from(capacityMap.values())) {
      if (cap.id) {
        // Compare against the true DB original state if provided, otherwise fallback to the capacities param
        const diffSource = dbCapacities ?? capacities;
        const originalCap = diffSource.find((c) => c.id === cap.id);
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
