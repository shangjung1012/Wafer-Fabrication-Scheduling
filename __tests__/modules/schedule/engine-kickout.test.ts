import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSchedule } from "@/modules/schedule/engine";
import { prisma } from "@/lib/prisma";
import { greedyBestFitStrategy } from "@/modules/schedule/strategy";
import * as orderRepo from "@/infra/db/order-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import * as assignmentRepo from "@/infra/db/assignment-repository";
import * as capacityRepo from "@/infra/db/capacity-repository";

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock("@/lib/generated/prisma", () => ({
  AssignmentStatus: {
    SCHEDULED: "SCHEDULED",
    IN_PRODUCTION: "IN_PRODUCTION",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
  },
  OrderStatus: {
    PENDING: "PENDING",
    APPROVED: "APPROVED",
    SCHEDULED: "SCHEDULED",
    IN_PRODUCTION: "IN_PRODUCTION",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (cb) =>
      cb({
        order: { findMany: vi.fn() },
      }),
    ),
    order: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/modules/schedule/strategy", () => ({
  greedyBestFitStrategy: vi.fn(),
}));

vi.mock("@/infra/db/order-repository", () => ({
  findOrdersForScheduling: vi.fn(),
  bulkUpdateOrderStatus: vi.fn(),
}));

vi.mock("@/infra/db/factory-repository", () => ({
  findFactoriesWithCapacities: vi.fn(),
}));

vi.mock("@/infra/db/assignment-repository", () => ({
  deleteScheduledAssignments: vi.fn(),
  createAssignments: vi.fn(),
}));

vi.mock("@/infra/db/capacity-repository", () => ({
  createDailyCapacities: vi.fn(),
  updateDailyCapacityById: vi.fn(),
}));

vi.mock("@/lib/get-time", () => ({
  getTime: vi.fn().mockResolvedValue(new Date("2026-05-17T00:00:00.000Z")),
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const emptyStrategyResult = {
  processedOrders: [],
  newAssignments: [],
  updatedCapacities: [],
  newCapacities: [],
  conflictOrderIds: [],
};

function makeOrder(overrides: object) {
  return {
    id: "O1",
    name: "Test Order",
    status: "APPROVED",
    assignments: [],
    applicant: { email: "sales@example.com", username: "salesperson" },
    ...overrides,
  };
}

function makeDbRow(overrides: object) {
  return {
    id: "O1",
    name: "Test Order",
    quantity: 100,
    dueDate: new Date("2026-06-01"),
    applicant: { email: "sales@example.com", username: "salesperson" },
    lastModifiedBy: { email: "admin@example.com", username: "admin1" },
    ...overrides,
  };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("runSchedule — conflict detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(factoryRepo.findFactoriesWithCapacities).mockResolvedValue([]);
    vi.mocked(assignmentRepo.deleteScheduledAssignments).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(assignmentRepo.createAssignments).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(orderRepo.bulkUpdateOrderStatus).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(capacityRepo.createDailyCapacities).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(capacityRepo.updateDailyCapacityById).mockResolvedValue(
      undefined as never,
    );
    vi.mocked(prisma.order.findMany).mockResolvedValue([]);
  });

  it("returns empty array when strategy reports no conflicts", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      makeOrder({}),
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      conflictOrderIds: [],
    });

    const result = await runSchedule("A");

    expect(result).toEqual([]);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it("returns ConflictOrderInfo with email fields when strategy reports conflicts", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      makeOrder({ id: "O1" }),
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      conflictOrderIds: ["O1"],
    });
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      makeDbRow({ id: "O1" }),
    ] as never);

    const result = await runSchedule("A");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "O1",
      name: "Test Order",
      quantity: 100,
      applicantEmail: "sales@example.com",
      applicantUsername: "salesperson",
      adminEmail: "admin@example.com",
      adminUsername: "admin1",
    });
  });

  it("formats dueDate as YYYY-MM-DD string", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      makeOrder({}),
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      conflictOrderIds: ["O1"],
    });
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      makeDbRow({ dueDate: new Date("2026-06-15") }),
    ] as never);

    const result = await runSchedule("A");

    expect(result[0].dueDate).toBe("2026-06-15");
  });

  it("returns null adminEmail when order has no lastModifiedBy", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      makeOrder({}),
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      conflictOrderIds: ["O1"],
    });
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      makeDbRow({ lastModifiedBy: null }),
    ] as never);

    const result = await runSchedule("A");

    expect(result[0].adminEmail).toBeNull();
    expect(result[0].adminUsername).toBeNull();
  });

  it("handles multiple conflict orders correctly", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      makeOrder({ id: "O1" }),
      makeOrder({ id: "O2" }),
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      conflictOrderIds: ["O1", "O2"],
    });
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      makeDbRow({ id: "O1" }),
      makeDbRow({ id: "O2" }),
    ] as never);

    const result = await runSchedule("A");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(
      expect.arrayContaining(["O1", "O2"]),
    );
  });

  it("queries only the conflict order IDs from the database", async () => {
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      makeOrder({}),
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      conflictOrderIds: ["O1"],
    });
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      makeDbRow({}),
    ] as never);

    await runSchedule("A");

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["O1"] } },
      }),
    );
  });
});
