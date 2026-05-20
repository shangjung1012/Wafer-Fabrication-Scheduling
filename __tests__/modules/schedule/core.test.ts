import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  prepareSchedulingData,
  applyScheduleTransaction,
} from "@/modules/schedule/core";
import { prisma } from "@/lib/prisma";
import * as orderRepo from "@/infra/db/order-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import * as assignmentRepo from "@/infra/db/assignment-repository";
import * as capacityRepo from "@/infra/db/capacity-repository";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";
import {
  type SchedulingConfig,
  type StrategyResult,
} from "@/modules/schedule/strategy";

const mockTx = {};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => callback(mockTx)),
  },
}));

vi.mock("@/infra/db/order-repository", () => ({
  findOrdersForScheduling: vi.fn(),
  applyScheduleOrdersUpdate: vi.fn(),
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

describe("Schedule Engine - Core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prepareSchedulingData", () => {
    it("should fetch orders and factories, and restore capacity based on policy", async () => {
      const fixedDate = new Date();
      fixedDate.setHours(0, 0, 0, 0);

      const mockOrders = [
        {
          id: "O1",
          status: OrderStatus.PENDING,
          assignments: [
            {
              factoryId: "F1",
              status: AssignmentStatus.SCHEDULED,
              productionDate: new Date(fixedDate),
              assignedQuantity: 50,
            },
          ],
        },
      ];
      const mockFactories = [
        {
          id: "F1",
          maxCapacity: 100,
          dailyCapacities: [
            {
              factoryId: "F1",
              date: new Date(fixedDate),
              curCapacity: 50,
            },
          ],
        },
      ];

      vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue(
        mockOrders as unknown as Awaited<
          ReturnType<typeof orderRepo.findOrdersForScheduling>
        >,
      );
      vi.mocked(factoryRepo.findFactoriesWithCapacities).mockResolvedValue(
        mockFactories as unknown as Awaited<
          ReturnType<typeof factoryRepo.findFactoriesWithCapacities>
        >,
      );

      const dummyConfig: SchedulingConfig = {
        startDate: new Date(fixedDate.getTime() - 86400000), // yesterday
        endDate: new Date(fixedDate.getTime() + 86400000), // tomorrow
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GLOBAL_OPTIMIZE",
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };

      const result = await prepareSchedulingData(
        "Type A",
        dummyConfig,
        fixedDate,
      );

      expect(orderRepo.findOrdersForScheduling).toHaveBeenCalledWith(
        prisma,
        "Type A",
        undefined,
      );
      expect(factoryRepo.findFactoriesWithCapacities).toHaveBeenCalledWith(
        prisma,
        "Type A",
        fixedDate,
      );
      expect(result.orders).toEqual(mockOrders);
      expect(result.factories).toEqual(mockFactories);
      expect(result.capacities[0].curCapacity).toBe(100); // 50 + 50 restored
      expect(result.orders[0].assignments).toEqual([]); // assignment removed
    });
  });

  describe("applyScheduleTransaction", () => {
    it("should apply results in a transaction", async () => {
      const mockStrategyResult = {
        processedOrders: [{ id: "O1", status: OrderStatus.SCHEDULED }],
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

      const dummyConfig: SchedulingConfig = {
        startDate: new Date(),
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GLOBAL_OPTIMIZE",
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };

      await applyScheduleTransaction(
        "Type A",
        dummyConfig,
        mockStrategyResult as unknown as StrategyResult,
      );

      expect(prisma.$transaction).toHaveBeenCalled();

      expect(assignmentRepo.deleteScheduledAssignments).toHaveBeenCalledWith(
        mockTx,
        ["O1"],
        dummyConfig.startDate,
        dummyConfig.endDate,
      );

      expect(orderRepo.applyScheduleOrdersUpdate).toHaveBeenCalledWith(
        mockTx,
        ["O1"],
        [],
        "SYSTEM",
      );

      expect(capacityRepo.createDailyCapacities).toHaveBeenCalledWith(
        mockTx,
        mockStrategyResult.newCapacities,
      );

      expect(capacityRepo.updateDailyCapacityById).toHaveBeenCalledWith(
        mockTx,
        "C1",
        0,
      );

      expect(assignmentRepo.createAssignments).toHaveBeenCalledWith(
        mockTx,
        mockStrategyResult.newAssignments,
      );
    });
  });
});
