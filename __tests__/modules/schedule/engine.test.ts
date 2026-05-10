import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSchedule } from "@/modules/schedule/engine";
import { prisma } from "@/lib/prisma";
import { greedyBestFitStrategy } from "@/modules/schedule/strategy";
import * as orderRepo from "@/infra/db/order-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import * as assignmentRepo from "@/infra/db/assignment-repository";
import * as capacityRepo from "@/infra/db/capacity-repository";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";

const mockTx = {};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => callback(mockTx)),
  },
}));

vi.mock("@/modules/schedule/strategy", () => ({
  greedyBestFitStrategy: vi.fn(),
}));

vi.mock("@/infra/db/order-repository", () => ({
  findOrdersForScheduling: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
}));

vi.mock("@/infra/db/factory-repository", () => ({
  findFactoriesWithCapacities: vi.fn(),
}));

vi.mock("@/infra/db/assignment-repository", () => ({
  deleteScheduledAssignments: vi.fn(),
  createAssignments: vi.fn(),
}));

vi.mock("@/infra/db/capacity-repository", () => ({
  createDailyCapacities: vi.fn(),
  updateDailyCapacityById: vi.fn(),
}));

describe("Schedule Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch data, run strategy, and execute atomic transaction with correct repository calls", async () => {
    const mockOrders = [{ id: "O1", status: OrderStatus.APPROVED }];
    const mockFactories = [{ id: "F1", maxCapacity: 100 }];

    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue(mockOrders as any);
    vi.mocked(factoryRepo.findFactoriesWithCapacities).mockResolvedValue(mockFactories as any);

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
      updatedCapacities: [{ id: "C1", factoryId: "F1", date: new Date(), maxCapacity: 100, curCapacity: 0 }],
      newCapacities:     [{ factoryId: "F2", date: new Date(), maxCapacity: 200, curCapacity: 100 }],
    };
    vi.mocked(greedyBestFitStrategy).mockReturnValue(mockStrategyResult);

    await runSchedule("Type A");

    // Data retrieval
    expect(orderRepo.findOrdersForScheduling).toHaveBeenCalledWith(prisma, "Type A");
    expect(factoryRepo.findFactoriesWithCapacities).toHaveBeenCalledWith(prisma, "Type A");

    // Strategy
    expect(greedyBestFitStrategy).toHaveBeenCalledWith(
      mockOrders,
      mockFactories,
      expect.any(Array),
      expect.any(Date),
    );

    // Transaction wraps all writes
    expect(prisma.$transaction).toHaveBeenCalled();

    // Repository calls inside transaction
    expect(assignmentRepo.deleteScheduledAssignments).toHaveBeenCalledWith(
      mockTx,
      ["O1", "O2"],
    );

    expect(orderRepo.bulkUpdateOrderStatus).toHaveBeenCalledWith(
      mockTx,
      [
        { id: "O1", status: OrderStatus.SCHEDULED },
        { id: "O2", status: OrderStatus.APPROVED },
      ],
    );

    expect(capacityRepo.createDailyCapacities).toHaveBeenCalledWith(
      mockTx,
      mockStrategyResult.newCapacities,
    );

    expect(capacityRepo.updateDailyCapacityById).toHaveBeenCalledWith(mockTx, "C1", 0);
    expect(capacityRepo.updateDailyCapacityById).toHaveBeenCalledTimes(1);

    expect(assignmentRepo.createAssignments).toHaveBeenCalledWith(
      mockTx,
      mockStrategyResult.newAssignments,
    );
  });

  it("should handle cases where strategy returns no new entities", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([]);
    vi.mocked(factoryRepo.findFactoriesWithCapacities).mockResolvedValue([]);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      processedOrders: [],
      newAssignments: [],
      updatedCapacities: [],
      newCapacities: [],
    });

    await runSchedule("Type B");

    expect(assignmentRepo.deleteScheduledAssignments).toHaveBeenCalledWith(mockTx, []);
    expect(orderRepo.bulkUpdateOrderStatus).toHaveBeenCalledWith(mockTx, []);
    expect(capacityRepo.createDailyCapacities).toHaveBeenCalledWith(mockTx, []);
    expect(capacityRepo.updateDailyCapacityById).not.toHaveBeenCalled();
    expect(assignmentRepo.createAssignments).toHaveBeenCalledWith(mockTx, []);
  });
});
