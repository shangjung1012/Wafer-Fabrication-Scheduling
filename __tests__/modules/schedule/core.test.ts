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
import * as conflictIssueRepo from "@/infra/db/conflict-issue-repository";
import * as mailTemplate from "@/modules/mail/mail-template";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma/client";
import {
  type SchedulingConfig,
  type StrategyResult,
} from "@/modules/schedule/strategy";
import { prepareIssueCreationPrep } from "@/modules/order/conflict-issue-service";

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
  bulkUpdateDailyCapacities: vi.fn(),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  withScheduleLock: vi.fn(async (type, cb) => {
    return cb();
  }),
  incrementScheduleVersion: vi.fn(),
}));

vi.mock("@/infra/db/conflict-issue-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/infra/db/conflict-issue-repository")
  >("@/infra/db/conflict-issue-repository");
  return {
    ...actual,
    createManyConflictIssues: vi.fn(),
    findConflictIssuesByOrderIds: vi.fn(),
    createManyConflictIssueEvents: vi.fn(),
  };
});

vi.mock("@/modules/mail/mail-template", () => ({
  renderAndSend: vi.fn(),
}));

vi.mock("@/modules/order/conflict-issue-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/order/conflict-issue-service")
  >("@/modules/order/conflict-issue-service");
  return {
    ...actual,
    prepareIssueCreationPrep: vi.fn(),
  };
});

describe("Schedule Engine - Core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("prepareSchedulingData", () => {
    it("should fetch orders and factories, and restore capacity based on policy", async () => {
      const fixedDate = new Date();
      fixedDate.setUTCHours(0, 0, 0, 0);

      const prodDate = new Date(fixedDate);
      prodDate.setUTCDate(prodDate.getUTCDate() + 2);

      const mockOrders = [
        {
          id: "O1",
          status: OrderStatus.PENDING,
          assignments: [
            {
              factoryId: "F1",
              status: AssignmentStatus.SCHEDULED,
              productionDate: new Date(prodDate),
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
              date: new Date(prodDate),
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
        startDate: new Date(fixedDate.getTime()),
        endDate: new Date(fixedDate.getTime() + 86400000 * 5),
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
        true,
      );

      expect(orderRepo.findOrdersForScheduling).toHaveBeenCalledWith(
        prisma,
        "Type A",
        undefined,
        true,
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

      vi.mocked(capacityRepo.bulkUpdateDailyCapacities).mockResolvedValue(
        new Set(["Type A"]),
      );

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
        "system-user",
      );

      expect(capacityRepo.createDailyCapacities).toHaveBeenCalledWith(
        mockTx,
        mockStrategyResult.newCapacities,
      );

      expect(capacityRepo.bulkUpdateDailyCapacities).toHaveBeenCalledWith(
        mockTx,
        mockStrategyResult.updatedCapacities,
      );

      expect(assignmentRepo.createAssignments).toHaveBeenCalledWith(
        mockTx,
        mockStrategyResult.newAssignments,
      );

      // version increments happen outside the transaction
      const scheduleStore = await import("@/infra/redis/schedule-store");
      expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith(
        "Type A",
      );
    });

    it("should handle failed orders by preparing issue data before the transaction and creating conflict issues inside it", async () => {
      const mockStrategyResult = {
        processedOrders: [
          { id: "O1", status: OrderStatus.SCHEDULED },
          { id: "O2", status: OrderStatus.FAILED },
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

      const dummyConfig: SchedulingConfig = {
        startDate: new Date(),
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GLOBAL_OPTIMIZE",
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };

      const mockPrepData = {
        newIssuesData: [
          {
            orderId: "O2",
            title: 'Cannot schedule "Order Two" — short by 600 units',
            status: "OPEN",
            createdById: "system-user",
            assigneeId: "SALES1",
            contextSnapshot: {},
          },
        ],
        eventsData: [],
        metadataMap: new Map([
          [
            "O2",
            {
              order: {
                id: "O2",
                name: "Order Two",
                quantity: 1000,
                dueDate: new Date(),
                updatedAt: new Date(),
              },
              deficit: 600,
              contextSnapshot: {},
              uniqueRecipients: [
                { email: "sales@test.com", username: "sales-user" },
              ],
            },
          ],
        ]),
        createdCount: 0,
        skippedCount: 0,
      };

      vi.mocked(conflictIssueRepo.createManyConflictIssues).mockResolvedValue(
        undefined,
      );
      vi.mocked(
        conflictIssueRepo.findConflictIssuesByOrderIds,
      ).mockResolvedValue([{ id: "ISSUE1", orderId: "O2", number: 101 }]);
      vi.mocked(
        conflictIssueRepo.createManyConflictIssueEvents,
      ).mockResolvedValue(undefined);
      vi.mocked(mailTemplate.renderAndSend).mockResolvedValue(undefined);
      vi.mocked(prepareIssueCreationPrep).mockResolvedValue(
        mockPrepData as unknown as Awaited<
          ReturnType<typeof prepareIssueCreationPrep>
        >,
      );
      vi.mocked(capacityRepo.bulkUpdateDailyCapacities).mockResolvedValue(
        new Set(["Type A"]),
      );

      await applyScheduleTransaction(
        "Type A",
        dummyConfig,
        mockStrategyResult as unknown as StrategyResult,
      );

      // Verify prepareIssueCreationPrep was called BEFORE the transaction with skipStatusCheck: true
      expect(prepareIssueCreationPrep).toHaveBeenCalledWith(
        prisma,
        ["O2"],
        "system-user",
        dummyConfig,
        expect.any(Date),
        true,
      );

      // Verify transaction was called
      expect(prisma.$transaction).toHaveBeenCalled();

      // Verify applyScheduleOrdersUpdate was called with both SCHEDULED and FAILED IDs
      expect(orderRepo.applyScheduleOrdersUpdate).toHaveBeenCalledWith(
        mockTx,
        ["O1"],
        ["O2"],
        "system-user",
      );

      // Verify createManyConflictIssues was called inside the transaction with prep data
      expect(conflictIssueRepo.createManyConflictIssues).toHaveBeenCalledWith(
        mockTx,
        mockPrepData.newIssuesData,
      );

      // Verify findConflictIssuesByOrderIds was called (to get DB-generated IDs)
      expect(
        conflictIssueRepo.findConflictIssuesByOrderIds,
      ).toHaveBeenCalledWith(mockTx, ["O2"]);

      // Verify createManyConflictIssueEvents was called (for OPENED events)
      expect(
        conflictIssueRepo.createManyConflictIssueEvents,
      ).toHaveBeenCalled();

      // Verify OCC version was incremented for affected factory types
      const scheduleStore = await import("@/infra/redis/schedule-store");
      expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith(
        "Type A",
      );
    });
  });
});
