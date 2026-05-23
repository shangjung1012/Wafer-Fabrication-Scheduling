import { describe, it, expect, vi } from "vitest";
import {
  createAssignments,
  findAssignmentsByIds,
} from "@/infra/db/assignment-repository";
import type { PrismaClient } from "@/lib/generated/prisma";
import { AssignmentStatus } from "@/lib/generated/prisma";

describe("assignment-repository", () => {
  describe("createAssignments", () => {
    it("should create assignments passing completionDate", async () => {
      const mockDb = {
        orderAssignment: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as PrismaClient;

      await createAssignments(mockDb, [
        {
          orderId: "O1",
          factoryId: "F1",
          productionDate: new Date("2023-01-01"),
          completionDate: new Date("2023-01-05"),
          assignedQuantity: 100,
          status: AssignmentStatus.SCHEDULED,
        },
      ]);

      expect(mockDb.orderAssignment.createMany).toHaveBeenCalledWith({
        data: [
          {
            orderId: "O1",
            factoryId: "F1",
            productionDate: new Date("2023-01-01"),
            completionDate: new Date("2023-01-05"),
            assignedQuantity: 100,
            status: AssignmentStatus.SCHEDULED,
          },
        ],
      });
    });
  });

  describe("findAssignmentsByIds", () => {
    it("should query assignments and select order.type", async () => {
      const mockDb = {
        orderAssignment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as unknown as PrismaClient;

      await findAssignmentsByIds(mockDb, ["A1"]);

      expect(mockDb.orderAssignment.findMany).toHaveBeenCalledWith({
        where: { id: { in: ["A1"] } },
        select: {
          id: true,
          orderId: true,
          factoryId: true,
          productionDate: true,
          completionDate: true,
          assignedQuantity: true,
          status: true,
          order: { select: { type: true } },
        },
      });
    });
  });
});
