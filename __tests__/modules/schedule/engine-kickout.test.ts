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

const mockTx = {};

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
    $transaction: vi.fn(async (cb) => cb(mockTx)),
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

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const emptyStrategyResult = {
  processedOrders: [],
  newAssignments: [],
  updatedCapacities: [],
  newCapacities: [],
};

function makeOrder(overrides: object) {
  return {
    id: "O1",
    name: "Test Order",
    status: "SCHEDULED",
    assignments: [],
    applicant: { email: "sales@example.com", username: "salesperson" },
    ...overrides,
  };
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("runSchedule — kicked-out detection", () => {
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
  });

  it("returns empty kickedOutOrders when no orders change from SCHEDULED to APPROVED", async () => {
    const order = makeOrder({ status: "SCHEDULED" });
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      order,
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      // Order stays SCHEDULED — not kicked out
      processedOrders: [{ id: "O1", status: "SCHEDULED" }],
    });

    const result = await runSchedule("A");

    expect(result.kickedOutOrders).toEqual([]);
  });

  it("returns kicked-out order when SCHEDULED order becomes APPROVED", async () => {
    const order = makeOrder({ status: "SCHEDULED" });
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      order,
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      // Order demoted back to APPROVED — kicked out
      processedOrders: [{ id: "O1", status: "APPROVED" }],
    });

    const result = await runSchedule("A");

    expect(result.kickedOutOrders).toHaveLength(1);
    expect(result.kickedOutOrders[0]).toMatchObject({
      id: "O1",
      name: "Test Order",
      applicantEmail: "sales@example.com",
      applicantUsername: "salesperson",
    });
  });

  it("does not include APPROVED orders that were already APPROVED before the run", async () => {
    // This order starts as APPROVED (not SCHEDULED) — it failed to schedule but was never in
    const order = makeOrder({ status: "APPROVED" });
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      order,
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      processedOrders: [{ id: "O1", status: "APPROVED" }],
    });

    const result = await runSchedule("A");

    expect(result.kickedOutOrders).toEqual([]);
  });

  it("does not include IN_PRODUCTION orders that stay in APPROVED (edge case — should never happen)", async () => {
    const order = makeOrder({ status: "IN_PRODUCTION" });
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      order,
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      processedOrders: [{ id: "O1", status: "IN_PRODUCTION" }],
    });

    const result = await runSchedule("A");

    expect(result.kickedOutOrders).toEqual([]);
  });

  it("handles multiple orders and correctly identifies only the kicked-out ones", async () => {
    const orders = [
      makeOrder({
        id: "O1",
        name: "Stays Scheduled",
        status: "SCHEDULED",
        applicant: { email: "a@e.com", username: "a" },
      }),
      makeOrder({
        id: "O2",
        name: "Kicked Out",
        status: "SCHEDULED",
        applicant: { email: "b@e.com", username: "b" },
      }),
      makeOrder({
        id: "O3",
        name: "Was Approved",
        status: "APPROVED",
        applicant: { email: "c@e.com", username: "c" },
      }),
    ];
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue(
      orders as never,
    );
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      processedOrders: [
        { id: "O1", status: "SCHEDULED" },
        { id: "O2", status: "APPROVED" }, // kicked out
        { id: "O3", status: "APPROVED" }, // was already APPROVED — not kicked out
      ],
    });

    const result = await runSchedule("A");

    expect(result.kickedOutOrders).toHaveLength(1);
    expect(result.kickedOutOrders[0].id).toBe("O2");
    expect(result.kickedOutOrders[0].applicantEmail).toBe("b@e.com");
  });

  it("skips kicked-out orders where applicant has no email", async () => {
    const order = makeOrder({ status: "SCHEDULED", applicant: null });
    vi.mocked(orderRepo.findOrdersForScheduling).mockResolvedValue([
      order,
    ] as never);
    vi.mocked(greedyBestFitStrategy).mockReturnValue({
      ...emptyStrategyResult,
      processedOrders: [{ id: "O1", status: "APPROVED" }],
    });

    const result = await runSchedule("A");

    expect(result.kickedOutOrders).toEqual([]);
  });
});
