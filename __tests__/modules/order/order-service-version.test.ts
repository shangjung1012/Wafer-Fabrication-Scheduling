import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus, type PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import * as orderRepo from "@/infra/db/order-repository";
import * as scheduleStore from "@/infra/redis/schedule-store";
import {
  createOrderService,
  deleteOrdersService,
  updateOrderService,
} from "@/modules/order/order-service";

vi.mock("@/modules/auth/scope", () => ({
  resolveActorScope: vi.fn(async (ctx: RequestContext) => ({
    role: ctx.user.role,
    userId: ctx.user.id,
    group: ctx.user.role === "ADMIN" ? "A" : undefined,
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
    createOrder: vi.fn(),
    updateOrder: vi.fn(),
    deleteOrders: vi.fn(),
    findOrderById: vi.fn(),
  };
});

const salesCtx: RequestContext = {
  requestId: "req-sales",
  user: { id: "sales-1", role: "SALES" },
};

const adminCtx: RequestContext = {
  requestId: "req-admin",
  user: { id: "admin-1", role: "ADMIN" },
};

const tx = {
  orderAssignment: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn(),
  },
};
const db = {
  $transaction: vi.fn(async (fn) => fn(tx)),
} as unknown as PrismaClient;

describe("order-service schedule version invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.orderAssignment.findMany.mockResolvedValue([]);
  });

  it("increments the schedule version when creating an order", async () => {
    vi.mocked(orderRepo.createOrder).mockResolvedValue({
      id: "O1",
      status: OrderStatus.PENDING,
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      quantity: 100,
      applicantId: "sales-1",
      name: "Order 1",
      type: "A",
      isFixed: false,
      isPrioritized: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastModifiedById: null,
    });

    await createOrderService(salesCtx, db, {
      name: "Order 1",
      type: "A",
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      quantity: 100,
    });

    expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith("A");
  });

  it("increments the schedule version only for schedule-affecting updates", async () => {
    vi.mocked(orderRepo.findOrderById).mockResolvedValue({
      id: "O1",
      status: OrderStatus.PENDING,
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      quantity: 100,
      applicantId: "sales-1",
      name: "Order 1",
      type: "A",
      isFixed: false,
      isPrioritized: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastModifiedById: null,
    });
    vi.mocked(orderRepo.updateOrder).mockResolvedValue({
      id: "O1",
      status: OrderStatus.PENDING,
      dueDate: new Date("2026-12-31T00:00:00.000Z"),
      quantity: 125,
      applicantId: "sales-1",
      name: "Order 1",
      type: "A",
      isFixed: false,
      isPrioritized: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastModifiedById: "sales-1",
    });

    await updateOrderService(salesCtx, db, "O1", { name: "Renamed" });
    expect(scheduleStore.incrementScheduleVersion).not.toHaveBeenCalled();

    await updateOrderService(salesCtx, db, "O1", { quantity: 125 });
    expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith("A");
  });

  it("increments the schedule version for each affected type when cancelling orders", async () => {
    vi.mocked(orderRepo.findOrderById)
      .mockResolvedValueOnce({
        id: "O1",
        status: OrderStatus.SCHEDULED,
        dueDate: new Date("2026-12-31T00:00:00.000Z"),
        quantity: 100,
        applicantId: "sales-1",
        name: "Order 1",
        type: "A",
        isFixed: false,
        isPrioritized: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastModifiedById: null,
      })
      .mockResolvedValueOnce({
        id: "O2",
        status: OrderStatus.PENDING,
        dueDate: new Date("2026-12-31T00:00:00.000Z"),
        quantity: 100,
        applicantId: "sales-2",
        name: "Order 2",
        type: "A",
        isFixed: false,
        isPrioritized: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastModifiedById: null,
      });
    vi.mocked(orderRepo.deleteOrders).mockResolvedValue({ count: 2 });

    await deleteOrdersService(adminCtx, db, ["O1", "O2"]);

    expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledTimes(1);
    expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith("A");
  });
});
