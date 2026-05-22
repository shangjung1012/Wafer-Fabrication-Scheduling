import { describe, it, expect, vi, beforeEach } from "vitest";
import { createIssuesForFailedOrders } from "@/modules/order/conflict-issue-service";
import * as orderRepo from "@/infra/db/order-repository";
import * as conflictRepo from "@/infra/db/conflict-issue-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import * as mailTemplate from "@/modules/mail/mail-template";
import * as strategy from "@/modules/schedule/strategy";
import type { PrismaClient } from "@/lib/generated/prisma";
import type { SchedulingConfig } from "@/modules/schedule/config";

vi.mock("@/infra/db/order-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/infra/db/order-repository")
  >("@/infra/db/order-repository");
  return {
    ...actual,
    findOrderForIssueCreation: vi.fn(),
    findCompetingScheduledOrders: vi.fn(),
  };
});

vi.mock("@/infra/db/conflict-issue-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/infra/db/conflict-issue-repository")
  >("@/infra/db/conflict-issue-repository");
  return {
    ...actual,
    createConflictIssue: vi.fn(),
    createConflictIssueEvent: vi.fn(),
    findOpenIssueByOrderId: vi.fn(),
  };
});

vi.mock("@/infra/db/factory-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/infra/db/factory-repository")
  >("@/infra/db/factory-repository");
  return {
    ...actual,
    findFactoriesForIssueSnapshot: vi.fn(),
  };
});

vi.mock("@/modules/mail/mail-template", () => ({
  renderAndSend: vi.fn(),
}));

vi.mock("@/modules/schedule/strategy", async () => {
  const actual = await vi.importActual<
    typeof import("@/modules/schedule/strategy")
  >("@/modules/schedule/strategy");
  return {
    ...actual,
    computeTotalAvailableCapacity: vi.fn(),
  };
});

// Suppress noisy console.error from negative-path tests
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const prisma = {} as unknown as PrismaClient;

const baseConfig: SchedulingConfig = {
  startDate: new Date("2026-05-01T00:00:00Z"),
  frozenDays: 1,
  productionDays: 14,
  bufferDays: 2,
  reschedulePolicy: "GAP_FILLING",
  algorithm: "GREEDY_BEST_FIT",
  splittable: true,
};

const runAt = new Date("2026-05-21T08:00:00Z");

type OrderFixture = Awaited<
  ReturnType<typeof orderRepo.findOrderForIssueCreation>
>;
type FactoryFixture = Awaited<
  ReturnType<typeof factoryRepo.findFactoriesForIssueSnapshot>
>[number];

function makeOrder(overrides: Partial<NonNullable<OrderFixture>> = {}) {
  return {
    id: "O1",
    name: "Order One",
    type: "Type A",
    quantity: 1000,
    dueDate: new Date("2026-05-20T00:00:00Z"),
    status: orderRepo.OrderStatus.FAILED,
    updatedAt: new Date("2026-05-19T00:00:00Z"),
    applicantId: "SALES1",
    applicant: {
      id: "SALES1",
      email: "sales@example.com",
      username: "sales-one",
    },
    ...overrides,
  } as NonNullable<OrderFixture>;
}

function makeFactory(overrides: Partial<FactoryFixture> = {}): FactoryFixture {
  return {
    id: "F1",
    productionType: "Type A",
    maxCapacity: 500,
    admins: [
      { id: "ADMIN1", email: "admin@example.com", username: "admin-one" },
    ],
    dailyCapacities: [],
    ...overrides,
  } as FactoryFixture;
}

describe("createIssuesForFailedOrders", () => {
  beforeEach(() => {
    // Reasonable default mock returns
    vi.mocked(strategy.computeTotalAvailableCapacity).mockReturnValue(400);
    vi.mocked(orderRepo.findCompetingScheduledOrders).mockResolvedValue([]);
    vi.mocked(factoryRepo.findFactoriesForIssueSnapshot).mockResolvedValue([
      makeFactory(),
    ]);
    vi.mocked(conflictRepo.findOpenIssueByOrderId).mockResolvedValue(null);
    vi.mocked(conflictRepo.createConflictIssue).mockResolvedValue({
      id: "ISSUE1",
      number: 101,
      createdAt: new Date("2026-05-21T08:00:01Z"),
    });
    vi.mocked(conflictRepo.createConflictIssueEvent).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof conflictRepo.createConflictIssueEvent>
      >,
    );
    vi.mocked(mailTemplate.renderAndSend).mockResolvedValue(undefined);
  });

  it("creates a new issue, writes OPENED event, sends email for a single failed order", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder(),
    );

    const res = await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "ADMIN1",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    expect(res).toEqual({ created: 1, skippedAsDuplicate: 0, failed: 0 });

    expect(conflictRepo.createConflictIssue).toHaveBeenCalledTimes(1);
    const issueArg = vi.mocked(conflictRepo.createConflictIssue).mock
      .calls[0][1];
    // required: 1000, available: 400 → deficit 600
    expect(issueArg.title).toBe(
      'Cannot schedule "Order One" — short by 600 units',
    );
    expect(issueArg.assigneeId).toBe("SALES1");
    expect(issueArg.createdById).toBe("ADMIN1");

    // OPENED event written
    const eventCalls = vi.mocked(conflictRepo.createConflictIssueEvent).mock
      .calls;
    expect(eventCalls.length).toBeGreaterThanOrEqual(1);
    expect(eventCalls[0][1].type).toBe(
      conflictRepo.ConflictIssueEventType.OPENED,
    );

    // Email sent — at least once
    expect(mailTemplate.renderAndSend).toHaveBeenCalled();
  });

  it("skips creation and writes CAPACITY_CHANGED-style event when an OPEN issue already exists", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder(),
    );
    vi.mocked(conflictRepo.findOpenIssueByOrderId).mockResolvedValue({
      id: "EXISTING1",
      status: conflictRepo.ConflictIssueStatus.OPEN,
    });

    const res = await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "ADMIN1",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    expect(res).toEqual({ created: 0, skippedAsDuplicate: 1, failed: 0 });
    expect(conflictRepo.createConflictIssue).not.toHaveBeenCalled();
    expect(mailTemplate.renderAndSend).not.toHaveBeenCalled();

    expect(conflictRepo.createConflictIssueEvent).toHaveBeenCalledTimes(1);
    const eventCall = vi.mocked(conflictRepo.createConflictIssueEvent).mock
      .calls[0][1];
    // Service uses REPREVIEW_RAN with payload reason: "CAPACITY_CHANGED"
    expect(eventCall.type).toBe(
      conflictRepo.ConflictIssueEventType.REPREVIEW_RAN,
    );
    expect((eventCall.payload as { reason?: string })?.reason).toBe(
      "CAPACITY_CHANGED",
    );
    expect(eventCall.issueId).toBe("EXISTING1");
  });

  it("falls back to a factory admin id when applicantId is null", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder({
        applicantId: null as unknown as string,
        applicant: null as unknown as NonNullable<OrderFixture>["applicant"],
      }),
    );

    const res = await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "SYSTEM",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    expect(res).toEqual({ created: 1, skippedAsDuplicate: 0, failed: 0 });

    const issueArg = vi.mocked(conflictRepo.createConflictIssue).mock
      .calls[0][1];
    expect(issueArg.assigneeId).toBe("ADMIN1");
  });

  it("propagates actorId as createdById on the new issue (system actor)", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder(),
    );

    await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "SYSTEM_AUTOSCHEDULER",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    const issueArg = vi.mocked(conflictRepo.createConflictIssue).mock
      .calls[0][1];
    expect(issueArg.createdById).toBe("SYSTEM_AUTOSCHEDULER");

    // OPENED event also carries the system actor
    const eventCall = vi.mocked(conflictRepo.createConflictIssueEvent).mock
      .calls[0][1];
    expect(eventCall.actorId).toBe("SYSTEM_AUTOSCHEDULER");
  });

  it("returns created:1 even when renderAndSend rejects (email failure is swallowed)", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder(),
    );
    vi.mocked(mailTemplate.renderAndSend).mockRejectedValue(
      new Error("SMTP down"),
    );

    const res = await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "ADMIN1",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    expect(res).toEqual({ created: 1, skippedAsDuplicate: 0, failed: 0 });
    expect(conflictRepo.createConflictIssue).toHaveBeenCalledTimes(1);
  });

  it("does not throw and increments failed when a per-order operation rejects unexpectedly", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder(),
    );
    vi.mocked(conflictRepo.createConflictIssue).mockRejectedValue(
      new Error("DB write failed"),
    );

    const res = await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "ADMIN1",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    expect(res).toEqual({ created: 0, skippedAsDuplicate: 0, failed: 1 });
    expect(mailTemplate.renderAndSend).not.toHaveBeenCalled();
  });

  it("skips orders whose status is no longer FAILED (no DB writes, no email, no counts)", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder({ status: orderRepo.OrderStatus.SCHEDULED }),
    );

    const res = await createIssuesForFailedOrders({
      failedOrderIds: ["O1"],
      actorId: "ADMIN1",
      runConfig: baseConfig,
      runAt,
      prisma,
    });

    expect(res).toEqual({ created: 0, skippedAsDuplicate: 0, failed: 0 });
    expect(conflictRepo.createConflictIssue).not.toHaveBeenCalled();
    expect(conflictRepo.createConflictIssueEvent).not.toHaveBeenCalled();
    expect(mailTemplate.renderAndSend).not.toHaveBeenCalled();
    expect(conflictRepo.findOpenIssueByOrderId).not.toHaveBeenCalled();
  });
});
