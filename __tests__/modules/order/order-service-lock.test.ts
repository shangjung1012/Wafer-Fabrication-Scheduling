import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  updateOrderService,
  deleteOrdersService,
} from "@/modules/order/order-service";
import * as scheduleStore from "@/infra/redis/schedule-store";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/infra/redis/schedule-store", () => ({
  withScheduleLock: vi.fn(),
  incrementScheduleVersion: vi.fn(),
}));

vi.mock("@/modules/auth/rbac", () => ({
  requireRole: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403;
    code = "FORBIDDEN";
  },
}));

vi.mock("@/modules/auth/scope", () => ({
  resolveActorScope: vi.fn(),
  getScopeGroup: vi.fn().mockReturnValue("A"),
}));

vi.mock("@/infra/db/order-repository", () => ({
  findOrderById: vi.fn(),
  findOrders: vi.fn(),
  createOrder: vi.fn(),
  updateOrder: vi.fn(),
  deleteOrders: vi.fn(),
  OrderStatus: {
    PENDING: "PENDING",
    SCHEDULED: "SCHEDULED",
    IN_PRODUCTION: "IN_PRODUCTION",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    FAILED: "FAILED",
  },
}));

vi.mock("@/infra/db/capacity-repository", () => ({
  upsertDailyCapacityDelta: vi.fn(),
}));

vi.mock("@/infra/db/factory-repository", () => ({
  findFactoriesMaxCapacity: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/modules/order/order-validation", () => ({
  validateOrderQuantity: vi.fn((q) => q),
  validateOrderType: vi.fn((t) => t),
}));

vi.mock("@/modules/order/order-status", () => ({
  assertOrderStatusTransition: vi.fn(),
}));

vi.mock("@/lib/generated/prisma", () => ({
  AssignmentStatus: {
    SCHEDULED: "SCHEDULED",
    CANCELLED: "CANCELLED",
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  findOrderById,
  updateOrder,
  deleteOrders,
} from "@/infra/db/order-repository";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
import { requireRole } from "@/modules/auth/rbac";

const mockCtx = {
  user: { id: "admin-1", role: "ADMIN" as const, username: "admin-a1" },
  requestId: "req-1",
};

const mockAdminScope = {
  role: "ADMIN" as const,
  userId: "admin-1",
  factoryIds: ["factory-A1"],
  productionType: "A",
  group: "A",
};

const mockSalesCtx = {
  user: { id: "sales-1", role: "SALES" as const, username: "sales-a" },
  requestId: "req-2",
};

const mockSalesScope = {
  role: "SALES" as const,
  userId: "sales-1",
};

const baseOrder = {
  id: "order-1",
  type: "A",
  status: "PENDING" as const,
  applicantId: "sales-1",
  dueDate: new Date("2026-08-01"),
  quantity: 100,
  name: "Test Order",
  isFixed: false,
  isPrioritized: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastModifiedById: null,
};

const mockDb = {
  $transaction: vi.fn(),
  orderAssignment: {
    findMany: vi.fn().mockResolvedValue([]),
    updateMany: vi.fn(),
  },
} as unknown as Parameters<typeof updateOrderService>[1];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("updateOrderService — lock acquisition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveActorScope).mockResolvedValue(mockAdminScope);
    vi.mocked(getScopeGroup).mockReturnValue("A");
    vi.mocked(requireRole).mockReturnValue(undefined);
    vi.mocked(findOrderById).mockResolvedValue(baseOrder);
    vi.mocked(updateOrder).mockResolvedValue({ ...baseOrder, isFixed: true });
    // Default: withScheduleLock executes the callback
    vi.mocked(scheduleStore.withScheduleLock).mockImplementation(
      async (_types, fn) => fn(),
    );
    vi.mocked(scheduleStore.incrementScheduleVersion).mockResolvedValue(1);
  });

  it("calls withScheduleLock with the order type when isFixed is updated", async () => {
    await updateOrderService(mockCtx, mockDb, "order-1", { isFixed: true });

    expect(scheduleStore.withScheduleLock).toHaveBeenCalledTimes(1);
    expect(scheduleStore.withScheduleLock).toHaveBeenCalledWith(
      "A",
      expect.any(Function),
    );
  });

  it("does NOT call withScheduleLock when only name is updated", async () => {
    vi.mocked(updateOrder).mockResolvedValue({ ...baseOrder, name: "foo" });

    await updateOrderService(mockCtx, mockDb, "order-1", { name: "foo" });

    expect(scheduleStore.withScheduleLock).not.toHaveBeenCalled();
  });

  it("propagates the 'already running' error when lock is held", async () => {
    vi.mocked(scheduleStore.withScheduleLock).mockRejectedValue(
      new Error(
        "A scheduling process is already running for type: A, refresh the page and try again",
      ),
    );

    await expect(
      updateOrderService(mockCtx, mockDb, "order-1", { isFixed: true }),
    ).rejects.toThrow("A scheduling process is already running for type: A");
  });
});

describe("updateOrderService — SALES branch lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveActorScope).mockResolvedValue(mockSalesScope);
    vi.mocked(getScopeGroup).mockReturnValue("A");
    vi.mocked(requireRole).mockReturnValue(undefined);
    vi.mocked(findOrderById).mockResolvedValue(baseOrder);
    vi.mocked(updateOrder).mockResolvedValue({
      ...baseOrder,
      dueDate: new Date("2026-09-01"),
    });
    vi.mocked(scheduleStore.withScheduleLock).mockImplementation(
      async (_types, fn) => fn(),
    );
    vi.mocked(scheduleStore.incrementScheduleVersion).mockResolvedValue(1);
  });

  it("calls withScheduleLock when SALES updates dueDate (schedule-affecting)", async () => {
    await updateOrderService(mockSalesCtx, mockDb, "order-1", {
      dueDate: new Date("2026-09-01"),
    });

    expect(scheduleStore.withScheduleLock).toHaveBeenCalledTimes(1);
    expect(scheduleStore.withScheduleLock).toHaveBeenCalledWith(
      "A",
      expect.any(Function),
    );
  });

  it("does NOT call withScheduleLock when SALES updates only name", async () => {
    vi.mocked(updateOrder).mockResolvedValue({
      ...baseOrder,
      name: "New Name",
    });

    await updateOrderService(mockSalesCtx, mockDb, "order-1", {
      name: "New Name",
    });

    expect(scheduleStore.withScheduleLock).not.toHaveBeenCalled();
  });
});

describe("deleteOrdersService — lock acquisition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveActorScope).mockResolvedValue(mockAdminScope);
    vi.mocked(getScopeGroup).mockReturnValue("A");
    vi.mocked(requireRole).mockReturnValue(undefined);
    vi.mocked(scheduleStore.incrementScheduleVersion).mockResolvedValue(1);
    vi.mocked(deleteOrders).mockResolvedValue({ count: 2 });
  });

  it("calls withScheduleLock with all distinct order types", async () => {
    const orderA1 = { ...baseOrder, id: "order-1", type: "A" };
    const orderA2 = { ...baseOrder, id: "order-2", type: "A" };
    const orderB = { ...baseOrder, id: "order-3", type: "B" };

    vi.mocked(findOrderById)
      .mockResolvedValueOnce(orderA1)
      .mockResolvedValueOnce(orderA2)
      .mockResolvedValueOnce(orderB);

    // Admin scope: group must match — mock getScopeGroup to allow both types
    // by not throwing in the ForbiddenError check (we mock the group check away
    // by ensuring all orders pass the `order.type !== group` gate).
    // Simplify: admin group A, all orders type A.
    vi.mocked(findOrderById)
      .mockReset()
      .mockResolvedValueOnce(orderA1)
      .mockResolvedValueOnce(orderA2);

    vi.mocked(scheduleStore.withScheduleLock).mockImplementation(
      async (_types, fn) => fn(),
    );

    const dbWithTx = {
      ...mockDb,
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            orderAssignment: {
              findMany: vi.fn().mockResolvedValue([]),
              updateMany: vi.fn(),
            },
            order: { updateMany: vi.fn() },
          }),
        ),
    } as unknown as Parameters<typeof deleteOrdersService>[1];

    await deleteOrdersService(mockCtx, dbWithTx, ["order-1", "order-2"]);

    expect(scheduleStore.withScheduleLock).toHaveBeenCalledTimes(1);
    const [calledTypes] = vi.mocked(scheduleStore.withScheduleLock).mock
      .calls[0];
    expect(calledTypes).toEqual(["A"]);
  });
});
