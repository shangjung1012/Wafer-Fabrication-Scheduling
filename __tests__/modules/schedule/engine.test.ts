import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSchedule } from "@/modules/schedule/engine";
import { prisma } from "@/lib/prisma";
import { greedyBestFitStrategy } from "@/modules/schedule/strategy";
import * as orderRepo from "@/infra/db/order-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";

// Mocks
const prismaMockTx = {
  orderAssignment: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  order: {
    update: vi.fn(),
  },
  dailyCapacity: {
    createMany: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => {
      return callback(prismaMockTx);
    }),
  },
}));

vi.mock("@/modules/schedule/strategy", () => ({
  greedyBestFitStrategy: vi.fn(),
}));

vi.mock("@/infra/db/order-repository", () => ({
  findOrdersForScheduling: vi.fn(),
}));

vi.mock("@/infra/db/factory-repository", () => ({
  findFactoriesWithCapacities: vi.fn(),
}));

describe("Schedule Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch data, run strategy, and execute atomic transaction with correct Prisma operations", async () => {
    const mockOrders = [{ id: "O1", status: OrderStatus.APPROVED }];
    const mockFactories = [{ id: "F1", maxCapacity: 100 }];

    // Setup Mock Returns
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue(
      mockOrders as any,
    );
    vi.mocked(factoryRepo.findFactoriesWithCapacities).mockResolvedValue(
      mockFactories as any,
    );

    const mockStrategyResult = {
      processedOrders: [
        { id: "O1", status: OrderStatus.SCHEDULED },
        { id: "O2", status: OrderStatus.APPROVED },
      ],
      newAssignments: [
        {
          orderId: "O1",
          factoryId: "F1",
          productionDate: new Date(),
          assignedQuantity: 100,
          status: AssignmentStatus.SCHEDULED,
        },
      ],
      updatedCapacities: [
        {
          id: "C1",
          factoryId: "F1",
          date: new Date(),
          maxCapacity: 100,
          curCapacity: 0,
        },
      ],
      newCapacities: [
        {
          factoryId: "F2",
          date: new Date(),
          maxCapacity: 200,
          curCapacity: 100,
        },
      ],
    };
    vi.mocked(greedyBestFitStrategy).mockReturnValue(mockStrategyResult);

    await runSchedule("Type A");

    // 1. Verify Data Retrieval
    expect(orderRepo.findOrdersForScheduling).toHaveBeenCalledWith(
      prisma,
      "Type A",
    );
    expect(factoryRepo.findFactoriesWithCapacities).toHaveBeenCalledWith(
      prisma,
      "Type A",
    );

    // 2. Verify Strategy Call
    expect(greedyBestFitStrategy).toHaveBeenCalledWith(
      mockOrders,
      mockFactories,
      expect.any(Array), // initial capacities extracted in engine
      expect.any(Date),
    );

    // 3. Verify Transaction Operations
    expect(prisma.$transaction).toHaveBeenCalled();

    // Delete Old Assignments
    expect(prismaMockTx.orderAssignment.deleteMany).toHaveBeenCalledWith({
      where: {
        orderId: { in: ["O1", "O2"] },
        status: AssignmentStatus.SCHEDULED,
      },
    });

    // Update Orders
    expect(prismaMockTx.order.update).toHaveBeenCalledWith({
      where: { id: "O1" },
      data: { status: OrderStatus.SCHEDULED },
    });
    expect(prismaMockTx.order.update).toHaveBeenCalledWith({
      where: { id: "O2" },
      data: { status: OrderStatus.APPROVED },
    });
    expect(prismaMockTx.order.update).toHaveBeenCalledTimes(2);

    // Insert New Capacities
    expect(prismaMockTx.dailyCapacity.createMany).toHaveBeenCalledWith({
      data: mockStrategyResult.newCapacities,
      skipDuplicates: true,
    });

    // Update Existing Capacities
    expect(prismaMockTx.dailyCapacity.update).toHaveBeenCalledWith({
      where: { id: "C1" },
      data: { curCapacity: 0 },
    });
    expect(prismaMockTx.dailyCapacity.update).toHaveBeenCalledTimes(1);

    // Insert New Assignments
    expect(prismaMockTx.orderAssignment.createMany).toHaveBeenCalledWith({
      data: mockStrategyResult.newAssignments,
    });
  });

  it("should handle cases where strategy returns no new entities to insert or update", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([]);
    vi.mocked(factoryRepo.findFactoriesWithCapacities).mockResolvedValue([]);

    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      processedOrders: [],
      newAssignments: [],
      updatedCapacities: [],
      newCapacities: [],
    });

    await runSchedule("Type B");

    // Only deleteMany should be called with empty array, others shouldn't be called
    // Actually, deleteMany should also not be called if there are no processed orders
    expect(prismaMockTx.orderAssignment.deleteMany).not.toHaveBeenCalled();

    expect(prismaMockTx.order.update).not.toHaveBeenCalled();
    expect(prismaMockTx.dailyCapacity.createMany).not.toHaveBeenCalled();
    expect(prismaMockTx.dailyCapacity.update).not.toHaveBeenCalled();
    expect(prismaMockTx.orderAssignment.createMany).not.toHaveBeenCalled();
  });
});
