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
    it("should fetch 0 PENDING orders if fetchAllPending is false and targetOrderIds is omitted", async () => {
      const mockDb = {
        order: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findOrdersForScheduling(mockDb, "Type A", undefined, false);

      expect(mockDb.order.findMany).toHaveBeenCalledWith({
        where: {
          type: "Type A",
          OR: [
            {
              status: {
                in: [OrderStatus.SCHEDULED, OrderStatus.IN_PRODUCTION],
              },
            },
            {
              status: OrderStatus.PENDING,
              id: { in: [] },
            },
          ],
        },
        include: {
          assignments: true,
          applicant: { select: { email: true, username: true } },
        },
      });
    });

    it("should fetch PENDING orders by targetOrderIds if fetchAllPending is false", async () => {
      const mockDb = {
        order: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findOrdersForScheduling(mockDb, "Type A", ["O1", "O2"], false);

      expect(mockDb.order.findMany).toHaveBeenCalledWith({
        where: {
          type: "Type A",
          OR: [
            {
              status: {
                in: [OrderStatus.SCHEDULED, OrderStatus.IN_PRODUCTION],
              },
            },
            {
              status: OrderStatus.PENDING,
              id: { in: ["O1", "O2"] },
            },
          ],
        },
        include: {
          assignments: true,
          applicant: { select: { email: true, username: true } },
        },
      });
    });

    it("should fetch all PENDING orders if fetchAllPending is true, ignoring targetOrderIds", async () => {
      const mockDb = {
        order: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findOrdersForScheduling(mockDb, "Type A", ["O1", "O2"], true);

      expect(mockDb.order.findMany).toHaveBeenCalledWith({
        where: {
          type: "Type A",
          OR: [
            {
              status: {
                in: [OrderStatus.SCHEDULED, OrderStatus.IN_PRODUCTION],
              },
            },
            {
              status: OrderStatus.PENDING,
            },
          ],
        },
        include: {
          assignments: true,
          applicant: { select: { email: true, username: true } },
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
    it("should route scheduled orders to SCHEDULED and failed orders to FAILED, and log operatorId", async () => {
      const mockDb = {
        order: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as PrismaClient;

      await applyScheduleOrdersUpdate(mockDb, ["S1"], ["F1"], "OP-123");

      expect(mockDb.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["S1"] },
          status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
        },
        data: { status: OrderStatus.SCHEDULED, lastModifiedById: "OP-123" },
      });

      expect(mockDb.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["F1"] },
          status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
        },
        data: { status: OrderStatus.FAILED, lastModifiedById: "OP-123" },
      });
    });
  });

  describe("findPendingOrderTypes", () => {
    it("should return unique order types for PENDING orders", async () => {
      const mockDb = {
        order: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ type: "Type A" }, { type: "Type B" }]),
        },
      } as unknown as PrismaClient;

      const { findPendingOrderTypes } =
        await import("@/infra/db/order-repository");

      const result = await findPendingOrderTypes(mockDb);

      expect(mockDb.order.findMany).toHaveBeenCalledWith({
        where: { status: OrderStatus.PENDING },
        select: { type: true },
        distinct: ["type"],
      });

      expect(result).toEqual(["Type A", "Type B"]);
    });
  });
});
