import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateOrder,
  deleteOrders,
  bulkUpdateOrderStatus,
  OrderStatus,
} from "@/infra/db/order-repository";
import {
  updateDailyCapacityById,
  bulkUpdateDailyCapacities,
} from "@/infra/db/capacity-repository";
import {
  findFactoriesForIssueSnapshot,
  findFactoriesForIssueSnapshotBulk,
  findFactoriesMaxCapacity,
  findFactoriesWithCapacities,
  updateFactory,
} from "@/infra/db/factory-repository";
import * as scheduleStore from "@/infra/redis/schedule-store";
import { FactoryStatus, type PrismaClient } from "@/lib/generated/prisma";

vi.mock("@/infra/redis/schedule-store", () => ({
  incrementScheduleVersion: vi.fn(),
}));

describe("Repository side effects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("order-repository", () => {
    it("updateOrder should not call Redis version invalidation", async () => {
      const mockDb = {
        order: {
          findUnique: vi.fn().mockResolvedValue({ id: "O1" }),
          update: vi.fn().mockResolvedValue({ id: "O1", type: "Type A" }),
        },
      } as unknown as PrismaClient;

      await updateOrder(mockDb, "O1", { status: OrderStatus.SCHEDULED });

      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });

    it("updateOrder should update name without version invalidation", async () => {
      const mockDb = {
        order: {
          findUnique: vi.fn().mockResolvedValue({ id: "O1" }),
          update: vi.fn().mockResolvedValue({ id: "O1", type: "Type A" }),
        },
      } as unknown as PrismaClient;

      await updateOrder(mockDb, "O1", { name: "New Name" });

      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });

    it("deleteOrders should not call Redis version invalidation", async () => {
      const mockDb = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      } as unknown as PrismaClient;

      await deleteOrders(mockDb, ["O1", "O2"]);

      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });

    it("bulkUpdateOrderStatus should not call Redis version invalidation", async () => {
      const mockDb = {
        order: {
          update: vi.fn().mockResolvedValue({ id: "O1" }),
        },
      } as unknown as PrismaClient;

      await bulkUpdateOrderStatus(mockDb, [
        { id: "O1", status: OrderStatus.SCHEDULED },
      ]);

      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });
  });

  describe("capacity-repository", () => {
    it("updateDailyCapacityById should NOT call incrementScheduleVersion (moved to caller)", async () => {
      const mockDb = {
        dailyCapacity: {
          findUnique: vi.fn().mockResolvedValue({ id: "C1" }),
          update: vi.fn().mockResolvedValue({}),
        },
      } as unknown as PrismaClient;

      await updateDailyCapacityById(mockDb, "C1", 100);

      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });

    it("bulkUpdateDailyCapacities should return affected factory types without calling Redis", async () => {
      const mockDb = {
        dailyCapacity: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "C1",
              factory: { productionType: "Type A" },
            },
          ]),
          update: vi.fn().mockResolvedValue({}),
        },
      } as unknown as PrismaClient;

      const result = await bulkUpdateDailyCapacities(mockDb, [
        { id: "C1", curCapacity: 100 },
      ]);

      expect(result).toBeInstanceOf(Set);
      expect(Array.from(result)).toEqual(["Type A"]);
      expect(mockDb.dailyCapacity.update).toHaveBeenCalledWith({
        where: { id: "C1" },
        data: { curCapacity: 100 },
      });
      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });
  });

  describe("factory-repository", () => {
    it("updateFactory should increment version if status or maxCapacity changes", async () => {
      const mockDb = {
        factory: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: "F1", productionType: "Type A" }),
          update: vi
            .fn()
            .mockResolvedValue({ id: "F1", productionType: "Type A" }),
        },
      } as unknown as PrismaClient;

      await updateFactory(mockDb, "F1", { maxCapacity: 200 });

      expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith(
        "Type A",
      );
    });

    it("updateFactory should return null when the factory does not exist", async () => {
      const mockDb = {
        factory: {
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
        },
      } as unknown as PrismaClient;

      const result = await updateFactory(mockDb, "F404", {
        status: FactoryStatus.INACTIVE,
      });

      expect(result).toBeNull();
      expect(mockDb.factory.update).not.toHaveBeenCalled();
      expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();
    });

    it("findFactoriesWithCapacities should include active factory capacities from current UTC day", async () => {
      const mockDb = {
        factory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findFactoriesWithCapacities(
        mockDb,
        "A",
        new Date("2026-06-15T18:30:00.000Z"),
      );

      expect(mockDb.factory.findMany).toHaveBeenCalledWith({
        where: {
          productionType: "A",
          status: FactoryStatus.ACTIVE,
        },
        include: {
          dailyCapacities: {
            where: {
              date: {
                gte: new Date("2026-06-15T00:00:00.000Z"),
              },
            },
          },
        },
      });
    });

    it("findFactoriesForIssueSnapshot should select admins and capacities within the window", async () => {
      const mockDb = {
        factory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;
      const windowStart = new Date("2026-06-01T00:00:00.000Z");
      const windowEnd = new Date("2026-06-30T00:00:00.000Z");

      await findFactoriesForIssueSnapshot(mockDb, "B", windowStart, windowEnd);

      expect(mockDb.factory.findMany).toHaveBeenCalledWith({
        where: {
          productionType: "B",
          status: FactoryStatus.ACTIVE,
        },
        select: {
          id: true,
          productionType: true,
          maxCapacity: true,
          admins: {
            select: { id: true, email: true, username: true },
          },
          dailyCapacities: {
            where: {
              date: { gte: windowStart, lte: windowEnd },
            },
            select: {
              id: true,
              factoryId: true,
              date: true,
              maxCapacity: true,
              curCapacity: true,
            },
          },
        },
      });
    });

    it("findFactoriesForIssueSnapshotBulk should group factories by production type", async () => {
      const mockDb = {
        factory: {
          findMany: vi.fn().mockResolvedValue([
            { id: "F1", productionType: "A" },
            { id: "F2", productionType: "B" },
            { id: "F3", productionType: "A" },
          ]),
        },
      } as unknown as PrismaClient;
      const windowStart = new Date("2026-06-01T00:00:00.000Z");
      const windowEnd = new Date("2026-06-30T00:00:00.000Z");

      const result = await findFactoriesForIssueSnapshotBulk(
        mockDb,
        ["A", "B"],
        windowStart,
        windowEnd,
      );

      expect(mockDb.factory.findMany).toHaveBeenCalledWith({
        where: {
          productionType: { in: ["A", "B"] },
          status: FactoryStatus.ACTIVE,
        },
        select: {
          id: true,
          productionType: true,
          maxCapacity: true,
          admins: {
            select: { id: true, email: true, username: true },
          },
          dailyCapacities: {
            where: {
              date: { gte: windowStart, lte: windowEnd },
            },
            select: {
              id: true,
              factoryId: true,
              date: true,
              maxCapacity: true,
              curCapacity: true,
            },
          },
        },
      });
      expect(result.get("A")).toEqual([
        { id: "F1", productionType: "A" },
        { id: "F3", productionType: "A" },
      ]);
      expect(result.get("B")).toEqual([{ id: "F2", productionType: "B" }]);
    });

    it("findFactoriesForIssueSnapshotBulk should skip the database for empty type lists", async () => {
      const mockDb = {
        factory: {
          findMany: vi.fn(),
        },
      } as unknown as PrismaClient;

      const result = await findFactoriesForIssueSnapshotBulk(
        mockDb,
        [],
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-30T00:00:00.000Z"),
      );

      expect(result.size).toBe(0);
      expect(mockDb.factory.findMany).not.toHaveBeenCalled();
    });

    it("findFactoriesMaxCapacity should select only id and maxCapacity", async () => {
      const mockDb = {
        factory: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: "F1", maxCapacity: 10000 }]),
        },
      } as unknown as PrismaClient;

      const result = await findFactoriesMaxCapacity(mockDb);

      expect(result).toEqual([{ id: "F1", maxCapacity: 10000 }]);
      expect(mockDb.factory.findMany).toHaveBeenCalledWith({
        select: { id: true, maxCapacity: true },
      });
    });
  });
});
