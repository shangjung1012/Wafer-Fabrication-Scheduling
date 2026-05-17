import { describe, it, expect, vi } from "vitest";
import {
  findOrdersForScheduling,
  updateOrder,
  applyScheduleOrdersUpdate,
  OrderStatus,
} from "@/infra/db/order-repository";
import type { PrismaClient } from "@/lib/generated/prisma";
import * as scheduleStore from "@/infra/redis/schedule-store";

vi.mock("@/infra/redis/schedule-store", () => ({
  incrementScheduleVersion: vi.fn(),
}));

describe("order-repository", () => {
  describe("findOrdersForScheduling", () => {
    it("should query orders by type and valid statuses without APPROVED and FAILED", async () => {
      const mockDb = {
        order: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findOrdersForScheduling(mockDb, "Type A");

      expect(mockDb.order.findMany).toHaveBeenCalledWith({
        where: {
          type: "Type A",
          status: {
            in: [
              OrderStatus.PENDING,
              OrderStatus.SCHEDULED,
              OrderStatus.IN_PRODUCTION,
            ],
          },
        },
        include: {
          assignments: true,
        },
      });
    });

    it("should include targetOrderIds in query if provided", async () => {
      const mockDb = {
        order: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findOrdersForScheduling(mockDb, "Type A", ["O1", "O2"]);

      expect(mockDb.order.findMany).toHaveBeenCalledWith({
        where: {
          type: "Type A",
          status: {
            in: [
              OrderStatus.PENDING,
              OrderStatus.SCHEDULED,
              OrderStatus.IN_PRODUCTION,
            ],
          },
          id: {
            in: ["O1", "O2"],
          },
        },
        include: {
          assignments: true,
        },
      });
    });
  });

  describe("updateOrder", () => {
    it("should update isFixed and isPrioritized and increment schedule version", async () => {
      const mockDb = {
        order: {
          findUnique: vi.fn().mockResolvedValue({ id: "O1", type: "Type A" }),
          update: vi.fn().mockResolvedValue({
            id: "O1",
            isFixed: true,
            isPrioritized: true,
          }),
        },
      } as unknown as PrismaClient;

      await updateOrder(mockDb, "O1", { isFixed: true, isPrioritized: true });

      expect(mockDb.order.update).toHaveBeenCalledWith({
        where: { id: "O1" },
        data: { isFixed: true, isPrioritized: true },
        select: expect.any(Object),
      });
      expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith(
        "Type A",
      );
    });
  });

  describe("applyScheduleOrdersUpdate", () => {
    it("should route unsuccessful orders to FAILED", async () => {
      const mockDb = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as PrismaClient;

      await applyScheduleOrdersUpdate(mockDb, ["S1"], ["F1"]);

      expect(mockDb.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["F1"] },
          status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
        },
        data: { status: OrderStatus.FAILED },
      });
    });
  });
});
