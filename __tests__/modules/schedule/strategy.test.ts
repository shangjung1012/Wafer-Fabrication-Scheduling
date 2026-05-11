import { describe, it, expect } from "vitest";
import {
  greedyBestFitStrategy,
  type SchedulingCapacityInput,
  type SchedulingFactoryInput,
  type SchedulingOrderInput,
} from "@/modules/schedule/strategy";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";

describe("Greedy Best-Fit Strategy", () => {
  const TODAY = new Date("2023-10-01T00:00:00.000Z");

  // Helper to create dates
  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  it("should successfully schedule a single order when capacity is sufficient", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 5),
        quantity: 100,
        createdAt: TODAY,
        assignments: [],
      },
    ];

    const factories: SchedulingFactoryInput[] = [{ id: "F1", maxCapacity: 200 }];

    const capacities: SchedulingCapacityInput[] = [
      {
        id: "C1",
        factoryId: "F1",
        date: addDays(TODAY, 1), // It must be TOMORROW to fall within the window Start
        curCapacity: 200,
        maxCapacity: 200,
      },
    ];

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    expect(result.processedOrders).toHaveLength(1);
    expect(result.processedOrders[0].status).toBe(OrderStatus.SCHEDULED);
    expect(result.newAssignments).toHaveLength(1);
    expect(result.newAssignments[0]).toMatchObject({
      orderId: "O1",
      factoryId: "F1",
      assignedQuantity: 100,
      status: AssignmentStatus.SCHEDULED,
    });

    const updatedCapacityForToday = result.updatedCapacities.find(
      (c) => c.factoryId === "F1",
    );
    expect(updatedCapacityForToday?.curCapacity).toBe(100);
  });

  it("should dynamically create capacity records if they do not exist", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 2),
        quantity: 50,
        createdAt: TODAY,
        assignments: [],
      },
    ];

    const factories: SchedulingFactoryInput[] = [{ id: "F1", maxCapacity: 100 }];

    const capacities: SchedulingCapacityInput[] = []; // Empty capacities!

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    expect(result.processedOrders[0].status).toBe(OrderStatus.SCHEDULED);
    expect(result.newAssignments).toHaveLength(1);
    expect(result.newCapacities).toHaveLength(1);
    expect(result.newCapacities[0]).toMatchObject({
      factoryId: "F1",
      maxCapacity: 100,
      curCapacity: 50, // 100 - 50 = 50
    });
  });

  it("should split an order across multiple factories/dates if needed (Best-Fit)", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 2), // window is TOMORROW and the day after
        quantity: 150,
        createdAt: TODAY,
        assignments: [],
      },
    ];

    const factories: SchedulingFactoryInput[] = [
      { id: "F1", maxCapacity: 100 },
      { id: "F2", maxCapacity: 200 },
    ];

    const capacities: SchedulingCapacityInput[] = [
      {
        id: "C1",
        factoryId: "F1",
        date: addDays(TODAY, 1),
        curCapacity: 50,
        maxCapacity: 100,
      },
      {
        id: "C2",
        factoryId: "F2",
        date: addDays(TODAY, 1),
        curCapacity: 120,
        maxCapacity: 200,
      },
    ];

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    // It should pick F2 first (120 capacity), then F1 (50 capacity) -> total 170 available
    expect(result.processedOrders[0].status).toBe(OrderStatus.SCHEDULED);
    expect(result.newAssignments).toHaveLength(2);

    const f2Assignment = result.newAssignments.find(
      (a) => a.factoryId === "F2",
    );
    const f1Assignment = result.newAssignments.find(
      (a) => a.factoryId === "F1",
    );

    expect(f2Assignment?.assignedQuantity).toBe(120);
    expect(f1Assignment?.assignedQuantity).toBe(30); // 150 - 120 = 30
  });

  it("should fail and rollback if an order cannot be fully fulfilled", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 2), // window is TOMORROW and the day after (if allowed)
        quantity: 150,
        createdAt: TODAY,
        assignments: [],
      },
    ];

    const factories: SchedulingFactoryInput[] = [{ id: "F1", maxCapacity: 50 }];

    const capacities: SchedulingCapacityInput[] = [
      {
        id: "C1",
        factoryId: "F1",
        date: addDays(TODAY, 1), // It must be in the valid window
        curCapacity: 50, // Available 50, plus 50 dynamically for day 2 -> total 100, needs 150 -> should fail
        maxCapacity: 50,
      },
    ];

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    expect(result.processedOrders[0].status).toBe(OrderStatus.APPROVED); // Remained APPROVED
    expect(result.newAssignments).toHaveLength(0); // No virtual assignments outputted

    // Capacity should be rolled back to 50
    // Result should NOT include C1 in updatedCapacities because it was rolled back to original
    const updatedCapacity = result.updatedCapacities.find((c) => c.id === "C1");
    expect(updatedCapacity).toBeUndefined();
  });

  it("should not schedule if remainingQty is fully covered by IN_PRODUCTION or COMPLETED assignments", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.IN_PRODUCTION,
        dueDate: addDays(TODAY, 5),
        quantity: 100,
        createdAt: TODAY,
        assignments: [
          { status: AssignmentStatus.IN_PRODUCTION, assignedQuantity: 100 },
        ],
      },
    ];

    const factories: SchedulingFactoryInput[] = [{ id: "F1", maxCapacity: 200 }];
    const capacities: SchedulingCapacityInput[] = [];

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    // No new assignments needed, remainingQty was 0
    expect(result.newAssignments).toHaveLength(0);
    expect(result.processedOrders[0].status).toBe(OrderStatus.IN_PRODUCTION); // Keeps original
  });

  it("should not downgrade IN_PRODUCTION parent status on failure", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.IN_PRODUCTION, // ALREADY in production
        dueDate: addDays(TODAY, 2), // window is TOMORROW and the day after
        quantity: 100,
        createdAt: TODAY,
        assignments: [
          { status: AssignmentStatus.IN_PRODUCTION, assignedQuantity: 50 }, // 50 left to schedule
        ],
      },
    ];

    const factories: SchedulingFactoryInput[] = [{ id: "F1", maxCapacity: 10 }]; // Only 10 per day -> 20 total for window, will fail (needs 50)
    const capacities: SchedulingCapacityInput[] = [
      {
        id: "C1",
        factoryId: "F1",
        date: addDays(TODAY, 1),
        curCapacity: 10,
        maxCapacity: 10,
      },
    ];

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    expect(result.newAssignments).toHaveLength(0); // Rolled back
    // MUST NOT downgrade to APPROVED
    expect(result.processedOrders[0].status).toBe(OrderStatus.IN_PRODUCTION);
  });

  it("should respect sorting priority (dueDate > quantity > createdAt)", () => {
    const orders: SchedulingOrderInput[] = [
      {
        id: "O1",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 5),
        quantity: 1000,
        createdAt: TODAY,
        assignments: [],
      },
      {
        id: "O2",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 3),
        quantity: 50,
        createdAt: TODAY,
        assignments: [],
      }, // Earliest
      {
        id: "O3",
        status: OrderStatus.APPROVED,
        dueDate: addDays(TODAY, 5),
        quantity: 1000,
        createdAt: TODAY,
        assignments: [],
      }, // Larger quantity
    ];

    const factories: SchedulingFactoryInput[] = [{ id: "F1", maxCapacity: 100 }];
    const capacities: SchedulingCapacityInput[] = [
      {
        id: "C1",
        factoryId: "F1",
        date: addDays(TODAY, 1),
        curCapacity: 60,
        maxCapacity: 100,
      },
    ];

    const result = greedyBestFitStrategy(orders, factories, capacities, TODAY);

    // Only 60 capacity total.
    // Sorting order should be: O2 (earliest), then O3 (larger qty), then O1
    // O2 gets scheduled (50). Remaining capacity = 10.
    // O3 fails.
    // O1 fails.

    expect(result.processedOrders.find((o) => o.id === "O2")?.status).toBe(
      OrderStatus.SCHEDULED,
    );
    expect(result.processedOrders.find((o) => o.id === "O3")?.status).toBe(
      OrderStatus.APPROVED,
    );
    expect(result.processedOrders.find((o) => o.id === "O1")?.status).toBe(
      OrderStatus.APPROVED,
    );
  });
});
