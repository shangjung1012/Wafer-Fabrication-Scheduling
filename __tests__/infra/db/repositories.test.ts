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
import { updateFactory } from "@/infra/db/factory-repository";
import * as scheduleStore from "@/infra/redis/schedule-store";
import type { PrismaClient } from "@/lib/generated/prisma";

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
  });
});
