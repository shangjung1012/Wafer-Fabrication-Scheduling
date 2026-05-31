import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssignmentStatus,
  OrderStatus,
  type PrismaClient,
} from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import * as orderRepo from "@/infra/db/order-repository";
import * as capacityRepo from "@/infra/db/capacity-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import { deleteOrdersService } from "@/modules/order/order-service";

vi.mock("@/modules/auth/scope", () => ({
  resolveActorScope: vi.fn(async (ctx: RequestContext) => ({
    role: ctx.user.role,
    userId: ctx.user.id,
    group: "A",
  })),
  getScopeGroup: vi.fn((scope: { group?: string }) => scope.group ?? "A"),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  incrementScheduleVersion: vi.fn(),
}));

vi.mock("@/infra/db/order-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infra/db/order-repository")>();
  return {
    ...actual,
    findOrderById: vi.fn(),
    deleteOrders: vi.fn(),
  };
});

vi.mock("@/infra/db/capacity-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infra/db/capacity-repository")>();
  return {
    ...actual,
    upsertDailyCapacityDelta: vi.fn(),
  };
});

vi.mock("@/infra/db/factory-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infra/db/factory-repository")>();
  return {
    ...actual,
    findFactoriesMaxCapacity: vi.fn(),
  };
});

const adminCtx: RequestContext = {
  requestId: "req-admin",
  user: { id: "admin-1", role: "ADMIN" },
};

describe("deleteOrdersService reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels scheduled assignments and releases their daily capacity in one transaction", async () => {
    const productionDate = new Date("2026-06-10T00:00:00.000Z");
    const tx = {
      orderAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "A1",
            factoryId: "F1",
            productionDate,
            assignedQuantity: 500,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const db = {
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as unknown as PrismaClient;

    vi.mocked(orderRepo.findOrderById).mockResolvedValue({
      id: "O1",
      status: OrderStatus.SCHEDULED,
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      quantity: 500,
      applicantId: "sales-1",
      name: "Order 1",
      type: "A",
      isFixed: false,
      isPrioritized: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastModifiedById: null,
    });
    vi.mocked(factoryRepo.findFactoriesMaxCapacity).mockResolvedValue([
      { id: "F1", maxCapacity: 10000 },
    ]);
    vi.mocked(orderRepo.deleteOrders).mockResolvedValue({ count: 1 });

    const result = await deleteOrdersService(adminCtx, db, ["O1"]);

    expect(result).toEqual({ count: 1 });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.orderAssignment.findMany).toHaveBeenCalledWith({
      where: {
        orderId: { in: ["O1"] },
        status: AssignmentStatus.SCHEDULED,
      },
      select: {
        id: true,
        factoryId: true,
        productionDate: true,
        assignedQuantity: true,
      },
    });
    expect(capacityRepo.upsertDailyCapacityDelta).toHaveBeenCalledWith(
      tx,
      "F1",
      productionDate,
      500,
      10000,
    );
    expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["A1"] } },
      data: { status: AssignmentStatus.CANCELLED },
    });
    expect(orderRepo.deleteOrders).toHaveBeenCalledWith(tx, ["O1"]);
  });
});
