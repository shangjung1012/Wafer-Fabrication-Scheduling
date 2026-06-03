import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any dynamic import of the service
// ---------------------------------------------------------------------------
const {
  resolveActorScope,
  getScheduleVersion,
  findFactoriesForVisualization,
  findAssignmentsForVisualization,
  findDailyCapacitiesForVisualization,
  findSalesAssignments,
  findPendingOrdersForSales,
  findPendingOrdersForAdmin,
  getTime,
} = vi.hoisted(() => ({
  resolveActorScope: vi.fn(),
  getScheduleVersion: vi.fn().mockResolvedValue(1),
  findFactoriesForVisualization: vi.fn().mockResolvedValue([]),
  findAssignmentsForVisualization: vi.fn().mockResolvedValue([]),
  findDailyCapacitiesForVisualization: vi.fn().mockResolvedValue([]),
  findSalesAssignments: vi.fn().mockResolvedValue([]),
  findPendingOrdersForSales: vi.fn().mockResolvedValue([]),
  findPendingOrdersForAdmin: vi.fn().mockResolvedValue([]),
  getTime: vi.fn().mockResolvedValue(new Date("2026-06-03T00:00:00.000Z")),
}));

vi.mock("@/modules/auth/scope", () => ({
  resolveActorScope,
  getScopeGroup: (scope: { group: string }) => scope.group,
}));
vi.mock("@/modules/auth/rbac", () => ({
  requireRole: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {
    status = 403;
    code = "FORBIDDEN";
  },
}));
vi.mock("@/infra/redis/schedule-store", () => ({ getScheduleVersion }));
vi.mock("@/infra/db/visualization-repository", () => ({
  findFactoriesForVisualization,
  findAssignmentsForVisualization,
  findDailyCapacitiesForVisualization,
  findSalesAssignments,
  findPendingOrdersForSales,
  findPendingOrdersForAdmin,
}));
vi.mock("@/lib/get-time", () => ({ getTime }));

import type { RequestContext } from "@/modules/auth/request-context";
import { getTimeline } from "@/modules/visualization/service";

const db = {} as Parameters<typeof getTimeline>[1];

function ctx(role: RequestContext["user"]["role"], id = "u-1"): RequestContext {
  return { user: { id, role }, requestId: "r-1" };
}

describe("getTimeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTime.mockResolvedValue(new Date("2026-06-03T00:00:00.000Z"));
    getScheduleVersion.mockResolvedValue(1);
    findFactoriesForVisualization.mockResolvedValue([]);
    findAssignmentsForVisualization.mockResolvedValue([]);
    findDailyCapacitiesForVisualization.mockResolvedValue([]);
    findPendingOrdersForAdmin.mockResolvedValue([]);
    findPendingOrdersForSales.mockResolvedValue([]);
    findSalesAssignments.mockResolvedValue([]);
  });

  it("returns adminContext for ADMIN scope", async () => {
    resolveActorScope.mockResolvedValue({
      role: "ADMIN",
      userId: "u-1",
      factoryIds: ["f-1"],
      productionType: "A",
      group: "A",
    });
    const result = await getTimeline(ctx("ADMIN"), db, {});
    expect(result.adminContext).toBeDefined();
    expect(result.salesContext).toBeUndefined();
  });

  it("returns adminContext for SUPERADMIN scope with all production types", async () => {
    resolveActorScope.mockResolvedValue({
      role: "SUPERADMIN",
      userId: "u-1",
      group: null,
    });
    const result = await getTimeline(ctx("SUPERADMIN"), db, {});
    expect(result.adminContext).toBeDefined();
  });

  it("returns salesContext when scope is SALES and has no assignments", async () => {
    resolveActorScope.mockResolvedValue({ role: "SALES", userId: "u-1" });
    const result = await getTimeline(ctx("SALES"), db, {});
    expect(result.salesContext).toBeDefined();
    expect(result.factories).toEqual([]);
    expect(result.timeline).toEqual([]);
  });

  it("returns salesContext with factory data when SALES has assignments", async () => {
    resolveActorScope.mockResolvedValue({ role: "SALES", userId: "u-1" });
    findSalesAssignments.mockResolvedValue([
      { factoryId: "f-1", orderId: "o-1" },
    ]);
    findFactoriesForVisualization.mockResolvedValue([
      { id: "f-1", productionType: "A", maxCapacity: 100 },
    ]);
    findAssignmentsForVisualization.mockResolvedValue([]);
    findDailyCapacitiesForVisualization.mockResolvedValue([]);
    const result = await getTimeline(ctx("SALES"), db, {});
    expect(result.salesContext).toBeDefined();
    expect(result.salesContext?.myOrderIds).toContain("o-1");
    expect(result.factories).toHaveLength(1);
  });

  it("detects capacity conflicts when curCapacity < 0", async () => {
    resolveActorScope.mockResolvedValue({
      role: "ADMIN",
      userId: "u-1",
      factoryIds: ["f-1"],
      productionType: "A",
      group: "A",
    });
    findDailyCapacitiesForVisualization.mockResolvedValue([
      {
        factoryId: "f-1",
        date: "2026-06-04",
        maxCapacity: 100,
        curCapacity: -20,
      },
    ]);
    findAssignmentsForVisualization.mockResolvedValue([
      {
        id: "a-1",
        orderId: "o-1",
        orderName: "Ord1",
        orderIsFixed: false,
        orderIsPrioritized: false,
        factoryId: "f-1",
        productionDate: "2026-06-04",
        assignedQuantity: 120,
        status: "SCHEDULED",
        orderDueDate: "2026-12-31",
        applicantId: "s-1",
        applicantUsername: "sales1",
        lastModifiedById: "s-1",
      },
    ]);
    const result = await getTimeline(ctx("ADMIN"), db, {});
    expect(result.conflicts.some((c) => c.conflictType === "CAPACITY")).toBe(
      true,
    );
  });

  it("detects due-date conflicts when productionDate > dueDate", async () => {
    resolveActorScope.mockResolvedValue({
      role: "ADMIN",
      userId: "u-1",
      factoryIds: ["f-1"],
      productionType: "A",
      group: "A",
    });
    findAssignmentsForVisualization.mockResolvedValue([
      {
        id: "a-1",
        orderId: "o-1",
        orderName: "Late",
        orderIsFixed: false,
        orderIsPrioritized: false,
        factoryId: "f-1",
        productionDate: "2027-01-01",
        assignedQuantity: 50,
        status: "SCHEDULED",
        orderDueDate: "2026-12-01",
        applicantId: "s-1",
        applicantUsername: "sales1",
        lastModifiedById: "s-1",
      },
    ]);
    const result = await getTimeline(ctx("ADMIN"), db, {});
    expect(result.conflicts.some((c) => c.conflictType === "DUE_DATE")).toBe(
      true,
    );
  });

  it("formats factory label from id", async () => {
    resolveActorScope.mockResolvedValue({
      role: "ADMIN",
      userId: "u-1",
      factoryIds: ["factory-A1"],
      productionType: "A",
      group: "A",
    });
    findFactoriesForVisualization.mockResolvedValue([
      { id: "factory-A1", productionType: "A", maxCapacity: 200 },
    ]);
    const result = await getTimeline(ctx("ADMIN"), db, {});
    expect(result.factories[0].label).toBe("Factory A1");
  });

  it("computes risk for pending orders correctly", async () => {
    resolveActorScope.mockResolvedValue({
      role: "ADMIN",
      userId: "u-1",
      factoryIds: ["f-1"],
      productionType: "A",
      group: "A",
    });
    const today = "2026-06-03";
    getTime.mockResolvedValue(new Date(`${today}T00:00:00.000Z`));
    findPendingOrdersForAdmin.mockResolvedValue([
      {
        id: "o-1",
        name: "Overdue",
        type: "A",
        quantity: 10,
        dueDate: "2026-06-01",
        createdAt: "2026-01-01",
        isFixed: false,
        isPrioritized: false,
      },
      {
        id: "o-2",
        name: "AtRisk",
        type: "A",
        quantity: 10,
        dueDate: "2026-06-05",
        createdAt: "2026-01-01",
        isFixed: false,
        isPrioritized: false,
      },
      {
        id: "o-3",
        name: "OnTrack",
        type: "A",
        quantity: 10,
        dueDate: "2026-06-20",
        createdAt: "2026-01-01",
        isFixed: false,
        isPrioritized: false,
      },
    ]);
    const result = await getTimeline(ctx("ADMIN"), db, {});
    const orders = result.adminContext!.pendingOrders;
    expect(orders.find((o) => o.id === "o-1")?.risk).toBe("OVERDUE");
    expect(orders.find((o) => o.id === "o-2")?.risk).toBe("AT_RISK");
    expect(orders.find((o) => o.id === "o-3")?.risk).toBe("ON_TRACK");
  });
});
