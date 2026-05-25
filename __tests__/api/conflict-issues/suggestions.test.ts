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

  it("splittable order: uses existing capacity and suggests correct date", async () => {
    // 1. Setup Issue
    mockPrisma.conflictIssue.findUnique = vi.fn().mockResolvedValue(baseIssue);

    // 2. Setup DailyCapacity scan results
    // windowEnd is 2024-05-10. Scan starts 2024-05-11.
    // Day 1 (05-11): A=10, B=0
    // Day 2 (05-12): A=15, B=0
    mockPrisma.dailyCapacity.findMany = vi.fn().mockResolvedValue([
      {
        factoryId: "factory-A",
        date: new Date("2024-05-11"),
        curCapacity: 10,
        maxCapacity: 100,
      },
      {
        factoryId: "factory-B",
        date: new Date("2024-05-11"),
        curCapacity: 0,
        maxCapacity: 100,
      },
      {
        factoryId: "factory-A",
        date: new Date("2024-05-12"),
        curCapacity: 15,
        maxCapacity: 100,
      },
      {
        factoryId: "factory-B",
        date: new Date("2024-05-12"),
        curCapacity: 0,
        maxCapacity: 100,
      },
    ]);

    const result = await getSuggestions(mockCtx, mockPrisma, 1);

    // We started with 80. Need 100.
    // Day 1 (+10) -> 90.
    // Day 2 (+15) -> 105. Meets requirement!
    // Found production date = 2024-05-12.
    // New due date = 2024-05-12 + 3 (prod) + 2 (buffer) = 2024-05-17.
    expect(result.scenarios.earliestFitForOriginalQty?.dueDate).toBe(
      "2024-05-17",
    );

    // maxFit should just be what's in the snapshot for splittable
    expect(result.scenarios.maxFitInOriginalWindow.quantity).toBe(80);
  });

  it("non-splittable order: looks for single block and suggests correct date", async () => {
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
    mockPrisma.dailyCapacity.findMany = vi.fn().mockImplementation((args) => {
      // Mock the scan query
      if (args.where.date.gte.toISOString().startsWith("2024-05-11")) {
        return Promise.resolve([
          {
            factoryId: "factory-A",
            date: new Date("2024-05-11"),
            curCapacity: 90,
            maxCapacity: 100,
          },
          {
            factoryId: "factory-B",
            date: new Date("2024-05-11"),
            curCapacity: 90,
            maxCapacity: 100,
          },
          {
            factoryId: "factory-A",
            date: new Date("2024-05-12"),
            curCapacity: 100,
            maxCapacity: 100,
          },
          {
            factoryId: "factory-B",
            date: new Date("2024-05-12"),
            curCapacity: 0,
            maxCapacity: 100,
          },
        ]);
      }

      // Mock the original window query [2024-05-01, 2024-05-10]
      // We must return records for ALL dates to prevent the default 100 fallback logic
      const results = [];
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

      // Inject the specific capacities we want to test
      results[0].curCapacity = 60; // factory-A on 05-01
      results[3].curCapacity = 80; // factory-B on 05-02

      return Promise.resolve(results);
    });

    const result = await getSuggestions(mockCtx, mockPrisma, 1);

    // Found production date = 2024-05-12 (factory-A has 100).
    // New due date = 2024-05-12 + 3 + 2 = 2024-05-17.
    expect(result.scenarios.earliestFitForOriginalQty?.dueDate).toBe(
      "2024-05-17",
    );

    // maxFit should compute max single block in original window (80 on 05-02)
    expect(result.scenarios.maxFitInOriginalWindow.quantity).toBe(80);
  });
});
