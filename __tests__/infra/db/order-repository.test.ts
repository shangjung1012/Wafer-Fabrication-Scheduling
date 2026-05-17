import { describe, it, expect, vi } from "vitest";
import {
  findOrdersForScheduling,
  OrderStatus,
} from "@/infra/db/order-repository";
import type { PrismaClient } from "@/lib/generated/prisma";

describe("order-repository", () => {
  describe("findOrdersForScheduling", () => {
    it("should query orders by type and valid statuses", async () => {
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
              OrderStatus.APPROVED,
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
              OrderStatus.APPROVED,
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
});
