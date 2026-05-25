import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSuggestions } from "@/modules/order/conflict-issue-service";
import { PrismaClient } from "@/lib/generated/prisma";
import { RequestContext } from "@/modules/auth/request-context";

// --- Mock Prisma ---
const mockPrisma = {
  conflictIssue: {
    findUnique: vi.fn(),
  },
  dailyCapacity: {
    findMany: vi.fn(),
  },
} as unknown as PrismaClient;

// --- Mock Auth ---
const mockCtx: RequestContext = {
  requestId: "req-1",
  user: {
    id: "admin-1",
    role: "ADMIN",
    username: "admin1",
  },
};

// Mock scope resolution to bypass auth logic
vi.mock("@/modules/auth/scope", () => ({
  resolveActorScope: vi.fn().mockResolvedValue([{ scopeGroup: "TYPE_A" }]),
  getScopeGroup: vi.fn().mockReturnValue("TYPE_A"),
}));

describe("getSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseSnapshot = {
    totalAvailableInWindow: 80,
    requiredQuantity: 100,
    deficit: 20,
    windowStart: "2024-05-01",
    windowEnd: "2024-05-10",
    factoriesConsidered: [
      { id: "factory-A", maxCapacity: 100 },
      { id: "factory-B", maxCapacity: 100 },
    ],
    orderSnapshot: {
      quantity: 100,
      dueDate: "2024-05-15", // dueDate
    },
    config: {
      splittable: true,
      productionDays: 3,
      bufferDays: 2,
    },
  };

  const baseIssue = {
    id: "issue-1",
    number: 1,
    orderId: "order-1",
    status: "OPEN",
    resolution: null,
    assigneeId: "sales-1",
    orderType: "TYPE_A",
    contextSnapshot: baseSnapshot,
    createdAt: new Date(),
    updatedAt: new Date(),
    order: {
      id: "order-1",
      type: "TYPE_A",
    },
    createdBy: { username: "sysadmin" },
    assignee: { username: "salesman" },
    comments: [],
    events: [],
    _count: { comments: 0 },
  };

  it("splittable order: dynamically calculates existing capacity from DB instead of using stale snapshot", async () => {
    // 1. Setup Issue
    mockPrisma.conflictIssue.findUnique = vi.fn().mockResolvedValue(baseIssue);
    // Note: baseIssue snapshot claims totalAvailableInWindow is 80.
    // We will test that it ignores this and uses what the DB actually returns (which we will mock to be 50).

    // 2. Setup DailyCapacity scan results
    // The new logic should query from trueWindowStart (2024-05-01) all the way through the search horizon.
    mockPrisma.dailyCapacity.findMany = vi.fn().mockImplementation(() => {
      const results = [];
      // -------------------------------------------------------------
      // Original Window Mocking [2024-05-01 to 2024-05-10]
      // -------------------------------------------------------------
      const start = new Date("2024-05-01");
      const end = new Date("2024-05-10");
      const iter = new Date(start);
      while (iter.getTime() <= end.getTime()) {
        results.push({
          factoryId: "factory-A",
          date: new Date(iter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        results.push({
          factoryId: "factory-B",
          date: new Date(iter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        iter.setDate(iter.getDate() + 1);
      }
      // Inject live capacity = 50 (instead of snapshot's 80)
      results[0].curCapacity = 30; // factory-A on 05-01
      results[1].curCapacity = 20; // factory-B on 05-01

      // -------------------------------------------------------------
      // Future Scan Mocking [2024-05-11 onwards]
      // -------------------------------------------------------------
      const futureStart = new Date("2024-05-11");
      const futureEnd = new Date("2024-05-13"); // just need enough to find a fit
      const futureIter = new Date(futureStart);
      while (futureIter.getTime() <= futureEnd.getTime()) {
        results.push({
          factoryId: "factory-A",
          date: new Date(futureIter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        results.push({
          factoryId: "factory-B",
          date: new Date(futureIter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        futureIter.setDate(futureIter.getDate() + 1);
      }

      // We need 100 total. We have 50. We need 50 more.
      // 2024-05-11 -> A:20, B:0 -> cumulative: 70
      results.find(
        (r) =>
          r.date.getTime() === new Date("2024-05-11").getTime() &&
          r.factoryId === "factory-A",
      )!.curCapacity = 20;
      // 2024-05-12 -> A:30, B:0 -> cumulative: 100 (Fit found!)
      results.find(
        (r) =>
          r.date.getTime() === new Date("2024-05-12").getTime() &&
          r.factoryId === "factory-A",
      )!.curCapacity = 30;

      return Promise.resolve(results);
    });

    const result = await getSuggestions(mockCtx, mockPrisma, 1);

    // Assert it correctly used 50 instead of 80 for the maxFit scenario
    expect(result.scenarios.maxFitInOriginalWindow.quantity).toBe(50);

    // Assert it correctly found the fit on 2024-05-12 and computed the new due date
    // 2024-05-12 + 3 (prod) + 2 (buffer) = 2024-05-17
    expect(result.scenarios.earliestFitForOriginalQty?.dueDate).toBe(
      "2024-05-17",
    );
  });

  it("non-splittable order: dynamically calculates existing capacity from DB instead of using stale snapshot", async () => {
    // 1. Setup Issue (non-splittable)
    const nonSplittableIssue = {
      ...baseIssue,
      contextSnapshot: {
        ...baseSnapshot,
        config: { ...baseSnapshot.config, splittable: false },
      },
    };
    mockPrisma.conflictIssue.findUnique = vi
      .fn()
      .mockResolvedValue(nonSplittableIssue);

    // 2. Setup DailyCapacity scan results
    mockPrisma.dailyCapacity.findMany = vi.fn().mockImplementation(() => {
      const results = [];
      // -------------------------------------------------------------
      // Original Window Mocking [2024-05-01 to 2024-05-10]
      // -------------------------------------------------------------
      const start = new Date("2024-05-01");
      const end = new Date("2024-05-10");
      const iter = new Date(start);
      while (iter.getTime() <= end.getTime()) {
        results.push({
          factoryId: "factory-A",
          date: new Date(iter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        results.push({
          factoryId: "factory-B",
          date: new Date(iter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        iter.setDate(iter.getDate() + 1);
      }

      // Inject live max block = 40 (instead of snapshot's 80)
      results[0].curCapacity = 40; // factory-A on 05-01

      // -------------------------------------------------------------
      // Future Scan Mocking [2024-05-11 onwards]
      // -------------------------------------------------------------
      const futureStart = new Date("2024-05-11");
      const futureEnd = new Date("2024-05-13"); // just need enough to find a fit
      const futureIter = new Date(futureStart);
      while (futureIter.getTime() <= futureEnd.getTime()) {
        results.push({
          factoryId: "factory-A",
          date: new Date(futureIter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        results.push({
          factoryId: "factory-B",
          date: new Date(futureIter),
          curCapacity: 0,
          maxCapacity: 100,
        });
        futureIter.setDate(futureIter.getDate() + 1);
      }

      // We need 100 in a single block.
      // Day 1 (05-11): factory-A has 90
      // Day 2 (05-12): factory-A has 100 (Fit found!)
      results.find(
        (r) =>
          r.date.getTime() === new Date("2024-05-11").getTime() &&
          r.factoryId === "factory-A",
      )!.curCapacity = 90;
      results.find(
        (r) =>
          r.date.getTime() === new Date("2024-05-12").getTime() &&
          r.factoryId === "factory-A",
      )!.curCapacity = 100;

      return Promise.resolve(results);
    });

    const result = await getSuggestions(mockCtx, mockPrisma, 1);

    // Found production date = 2024-05-12 (factory-A has 100).
    // New due date = 2024-05-12 + 3 + 2 = 2024-05-17.
    expect(result.scenarios.earliestFitForOriginalQty?.dueDate).toBe(
      "2024-05-17",
    );

    // maxFit should compute max single block in original window dynamically (40)
    expect(result.scenarios.maxFitInOriginalWindow.quantity).toBe(40);
  });
});
