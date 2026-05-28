import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acceptProposal,
  createIssuesForFailedOrders,
  listConflictIssues,
} from "@/modules/order/conflict-issue-service";
import * as orderRepo from "@/infra/db/order-repository";
import * as conflictRepo from "@/infra/db/conflict-issue-repository";
import * as factoryRepo from "@/infra/db/factory-repository";
import * as scopeModule from "@/modules/auth/scope";
import * as mailTemplate from "@/modules/mail/mail-template";
import * as userRepo from "@/infra/db/user-repository";
import * as strategy from "@/modules/schedule/strategy";
import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import type { SchedulingConfig } from "@/modules/schedule/config";

vi.mock("@/infra/db/order-repository", async () => {
  const actual = await vi.importActual<
    typeof import("@/infra/db/order-repository")
  >("@/infra/db/order-repository");
  return {
    ...actual,
    findOrderForIssueCreation: vi.fn(),
    findCompetingScheduledOrders: vi.fn(),
    updateOrder: vi.fn(),
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
    createManyConflictIssues: vi.fn(),
    findConflictIssuesByOrderIds: vi.fn(),
    createManyConflictIssueEvents: vi.fn(),
    findOpenIssueByOrderId: vi.fn(),
    findCommentById: vi.fn(),
    findConflictIssueById: vi.fn(),
    updateCommentProposalStatus: vi.fn(),
    staleOtherProposals: vi.fn(),
    updateConflictIssue: vi.fn(),
  };
});

vi.mock("@/infra/db/user-repository", () => ({
  findUserById: vi.fn(),
  findUsers: vi.fn(),
}));

vi.mock("@/modules/auth/scope", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth/scope")>(
    "@/modules/auth/scope",
  );
  return {
    ...actual,
    resolveActorScope: vi.fn(),
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

const prisma = {
  $transaction: vi.fn(async (cb) => cb(prisma)),
} as unknown as PrismaClient;

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
    vi.mocked(conflictRepo.createManyConflictIssues).mockResolvedValue(
      undefined,
    );
    vi.mocked(conflictRepo.createManyConflictIssueEvents).mockResolvedValue(
      undefined,
    );
    vi.mocked(conflictRepo.findConflictIssuesByOrderIds).mockResolvedValue([
      { id: "ISSUE1", orderId: "O1", number: 101 },
    ]);
    vi.mocked(userRepo.findUsers).mockResolvedValue([
      {
        id: "SUPERADMIN1",
        email: "super@example.com",
        username: "superadmin",
        role: "SUPERADMIN",
        group: null,
      } as unknown as Awaited<ReturnType<typeof userRepo.findUsers>>[number],
    ]);
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

    expect(conflictRepo.createManyConflictIssues).toHaveBeenCalledTimes(1);
    const issuesArg = vi.mocked(conflictRepo.createManyConflictIssues).mock
      .calls[0][1];
    // required: 1000, available: 400 → deficit 600
    expect(issuesArg[0].title).toBe(
      'Cannot schedule "Order One" — short by 600 units',
    );
    expect(issuesArg[0].assigneeId).toBe("SALES1");
    expect(issuesArg[0].createdById).toBe("ADMIN1");

    // OPENED event written
    const eventsArg = vi.mocked(conflictRepo.createManyConflictIssueEvents).mock
      .calls[0][1];
    expect(eventsArg.length).toBeGreaterThanOrEqual(1);
    expect(eventsArg[0].type).toBe(conflictRepo.ConflictIssueEventType.OPENED);

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
    expect(conflictRepo.createManyConflictIssues).not.toHaveBeenCalled();
    expect(mailTemplate.renderAndSend).not.toHaveBeenCalled();

    expect(conflictRepo.createManyConflictIssueEvents).toHaveBeenCalledTimes(1);
    const eventsArg = vi.mocked(conflictRepo.createManyConflictIssueEvents).mock
      .calls[0][1];
    const eventCall = eventsArg[0];
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

    const issuesArg = vi.mocked(conflictRepo.createManyConflictIssues).mock
      .calls[0][1];
    expect(issuesArg[0].assigneeId).toBe("ADMIN1");
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

    const issuesArg = vi.mocked(conflictRepo.createManyConflictIssues).mock
      .calls[0][1];
    expect(issuesArg[0].createdById).toBe("SYSTEM_AUTOSCHEDULER");

    // OPENED event also carries the system actor
    const eventsArg = vi.mocked(conflictRepo.createManyConflictIssueEvents).mock
      .calls[0][1];
    expect(eventsArg[0].actorId).toBe("SYSTEM_AUTOSCHEDULER");
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
    expect(conflictRepo.createManyConflictIssues).toHaveBeenCalledTimes(1);
  });

  it("does not throw and increments failed when a per-order operation rejects unexpectedly", async () => {
    vi.mocked(orderRepo.findOrderForIssueCreation).mockResolvedValue(
      makeOrder(),
    );
    vi.mocked(conflictRepo.createManyConflictIssues).mockRejectedValue(
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
    expect(conflictRepo.createManyConflictIssues).not.toHaveBeenCalled();
    expect(conflictRepo.createManyConflictIssueEvents).not.toHaveBeenCalled();
    expect(mailTemplate.renderAndSend).not.toHaveBeenCalled();
    expect(conflictRepo.findOpenIssueByOrderId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listConflictIssues — role-scoped filters merged with IssueFilters
// ---------------------------------------------------------------------------

describe("listConflictIssues", () => {
  let findIssuesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findIssuesSpy = vi
      .spyOn(conflictRepo, "findConflictIssues")
      .mockResolvedValue([]);
    vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
      role: "ADMIN",
      userId: "ADMIN1",
      factoryIds: ["F1"],
      productionType: "Type A",
      group: "Type A",
    });
  });

  afterEach(() => {
    findIssuesSpy.mockRestore();
  });

  it("SALES: passes assigneeId plus caller-supplied statuses to the repository", async () => {
    const salesCtx: RequestContext = {
      user: { id: "SALES1", role: "SALES", username: "sales-1" },
      requestId: "req-s",
    };
    await listConflictIssues(salesCtx, prisma, {
      statuses: [conflictRepo.ConflictIssueStatus.OPEN],
    });
    expect(findIssuesSpy).toHaveBeenCalledWith(prisma, {
      assigneeId: "SALES1",
      statuses: [conflictRepo.ConflictIssueStatus.OPEN],
    });
    expect(scopeModule.resolveActorScope).not.toHaveBeenCalled();
  });

  it("ADMIN: passes orderType from scope plus caller-supplied statuses", async () => {
    vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
      role: "ADMIN",
      userId: "ADMIN1",
      factoryIds: ["F1"],
      productionType: "Type B",
      group: "Type B",
    });
    const adminCtx: RequestContext = {
      user: { id: "ADMIN1", role: "ADMIN", username: "admin-A" },
      requestId: "req-a",
    };
    await listConflictIssues(adminCtx, prisma, {
      statuses: [
        conflictRepo.ConflictIssueStatus.OPEN,
        conflictRepo.ConflictIssueStatus.IN_DISCUSSION,
      ],
    });
    expect(findIssuesSpy).toHaveBeenCalledWith(prisma, {
      orderType: "Type B",
      statuses: [
        conflictRepo.ConflictIssueStatus.OPEN,
        conflictRepo.ConflictIssueStatus.IN_DISCUSSION,
      ],
    });
  });

  it("ADMIN: forwards empty statuses array (repository treats like no status filter)", async () => {
    const adminCtx: RequestContext = {
      user: { id: "ADMIN1", role: "ADMIN", username: "admin-A" },
      requestId: "req-a",
    };
    await listConflictIssues(adminCtx, prisma, { statuses: [] });
    expect(findIssuesSpy).toHaveBeenCalledWith(prisma, {
      orderType: "Type A",
      statuses: [],
    });
  });
});

// ---------------------------------------------------------------------------
// acceptProposal — OCC regression tests
//
// Regression: the conflict-issue UI used to pass ConflictIssue.updatedAt as
// `expectedOrderUpdatedAt`, but the OCC check compares against Order.updatedAt.
// The two timestamps are from different rows and almost never match, so every
// Accept click marked the proposal STALE. The fix exposes Order.updatedAt as
// ConflictIssueDetail.orderUpdatedAt; these tests pin the contract that the
// OCC compares against Order.updatedAt, not the issue's updatedAt.
// ---------------------------------------------------------------------------

describe("acceptProposal — OCC", () => {
  const ORDER_UPDATED_AT = new Date("2026-05-21T08:00:00Z");
  const ISSUE_UPDATED_AT = new Date("2026-05-21T08:00:05Z"); // different from order

  function makeComment(overrides: {
    expectedOrderUpdatedAt: Date;
    authorId?: string;
    kind?: "REDUCE_QUANTITY" | "DELAY_DUE_DATE" | "CANCEL";
    newQuantity?: number;
    newDueDate?: string;
    status?: "PENDING" | "ACCEPTED" | "REJECTED" | "STALE";
  }) {
    const {
      expectedOrderUpdatedAt,
      authorId = "SALES1",
      kind = "DELAY_DUE_DATE",
      newDueDate = "2026-05-25",
      status = "PENDING",
    } = overrides;

    return {
      id: "C1",
      issueId: "ISSUE1",
      authorId,
      body: "Please delay the due date",
      proposal: {
        proposal: {
          kind,
          ...(kind === "DELAY_DUE_DATE" ? { newDueDate } : {}),
        },
        expectedOrderUpdatedAt: expectedOrderUpdatedAt.toISOString(),
        status,
      },
      editedAt: null,
      createdAt: new Date("2026-05-21T07:59:00Z"),
      issue: {
        id: "ISSUE1",
        orderId: "O1",
        status: conflictRepo.ConflictIssueStatus.IN_DISCUSSION,
        order: {
          type: "Type A",
          updatedAt: ORDER_UPDATED_AT,
          quantity: 1000,
          dueDate: new Date("2026-05-20T00:00:00Z"),
        },
      },
    };
  }

  const salesCtx: RequestContext = {
    user: { id: "SALES1", role: "SALES", username: "sales-1" },
    requestId: "req-1",
  };

  const adminCtx: RequestContext = {
    user: { id: "ADMIN1", role: "ADMIN", username: "admin-A" },
    requestId: "req-2",
  };

  beforeEach(() => {
    // Default scope mock for admin path
    vi.mocked(scopeModule.resolveActorScope).mockResolvedValue({
      role: "ADMIN",
      userId: "ADMIN1",
      factoryIds: ["F1"],
      productionType: "Type A",
      group: "Type A",
    });

    // assertIssueAccess uses findConflictIssueById
    vi.mocked(conflictRepo.findConflictIssueById).mockResolvedValue({
      id: "ISSUE1",
      orderId: "O1",
      assigneeId: "SALES1",
      status: conflictRepo.ConflictIssueStatus.IN_DISCUSSION,
      order: { type: "Type A", updatedAt: ORDER_UPDATED_AT },
    });

    vi.mocked(orderRepo.updateOrder).mockResolvedValue(
      undefined as unknown as Awaited<ReturnType<typeof orderRepo.updateOrder>>,
    );
    vi.mocked(conflictRepo.updateCommentProposalStatus).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof conflictRepo.updateCommentProposalStatus>
      >,
    );
    vi.mocked(conflictRepo.staleOtherProposals).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof conflictRepo.staleOtherProposals>
      >,
    );
    vi.mocked(conflictRepo.updateConflictIssue).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof conflictRepo.updateConflictIssue>
      >,
    );
    vi.mocked(conflictRepo.createConflictIssueEvent).mockResolvedValue(
      undefined as unknown as Awaited<
        ReturnType<typeof conflictRepo.createConflictIssueEvent>
      >,
    );
  });

  it("accepts when expectedOrderUpdatedAt matches Order.updatedAt (the fix path)", async () => {
    // Sales captured Order.updatedAt at proposal time — the only correct value.
    vi.mocked(conflictRepo.findCommentById).mockResolvedValue(
      makeComment({
        expectedOrderUpdatedAt: ORDER_UPDATED_AT,
      }) as unknown as Awaited<ReturnType<typeof conflictRepo.findCommentById>>,
    );

    await expect(
      acceptProposal(adminCtx, prisma, "C1"),
    ).resolves.toBeUndefined();

    // Proposal was ACCEPTED — NOT STALE
    expect(conflictRepo.updateCommentProposalStatus).toHaveBeenCalledWith(
      prisma,
      "C1",
      "ACCEPTED",
    );
    expect(conflictRepo.updateCommentProposalStatus).not.toHaveBeenCalledWith(
      prisma,
      "C1",
      "STALE",
    );

    // Order was updated (DELAY_DUE_DATE applied)
    expect(orderRepo.updateOrder).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(orderRepo.updateOrder).mock.calls[0];
    expect(updateCall[1]).toBe("O1");
    expect((updateCall[2] as { dueDate?: Date }).dueDate).toEqual(
      new Date("2026-05-25T00:00:00.000Z"),
    );

    // Issue marked RESOLVED
    expect(conflictRepo.updateConflictIssue).toHaveBeenCalledWith(
      prisma,
      "ISSUE1",
      expect.objectContaining({
        status: conflictRepo.ConflictIssueStatus.RESOLVED,
      }),
    );

    // Other pending proposals stale-d
    expect(conflictRepo.staleOtherProposals).toHaveBeenCalledWith(
      prisma,
      "ISSUE1",
      "C1",
    );
  });

  it("marks proposal STALE and throws 409 when expectedOrderUpdatedAt does NOT match Order.updatedAt", async () => {
    // The bug case: frontend passed ConflictIssue.updatedAt (≠ Order.updatedAt).
    vi.mocked(conflictRepo.findCommentById).mockResolvedValue(
      makeComment({
        expectedOrderUpdatedAt: ISSUE_UPDATED_AT,
      }) as unknown as Awaited<ReturnType<typeof conflictRepo.findCommentById>>,
    );

    await expect(acceptProposal(adminCtx, prisma, "C1")).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("modified"),
    });

    // Proposal marked STALE
    expect(conflictRepo.updateCommentProposalStatus).toHaveBeenCalledWith(
      prisma,
      "C1",
      "STALE",
    );

    // Order was NOT updated
    expect(orderRepo.updateOrder).not.toHaveBeenCalled();
    // Issue was NOT resolved
    expect(conflictRepo.updateConflictIssue).not.toHaveBeenCalled();
  });

  it("regression: ConflictIssue.updatedAt is the WRONG OCC baseline (this is the original bug)", async () => {
    // Documents the bug — if the UI ever regresses to passing issue.updatedAt
    // instead of order.updatedAt, this test fails fast.
    expect(ORDER_UPDATED_AT.getTime()).not.toBe(ISSUE_UPDATED_AT.getTime());

    vi.mocked(conflictRepo.findCommentById).mockResolvedValue(
      makeComment({
        expectedOrderUpdatedAt: ISSUE_UPDATED_AT,
      }) as unknown as Awaited<ReturnType<typeof conflictRepo.findCommentById>>,
    );

    await expect(acceptProposal(adminCtx, prisma, "C1")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("rejects when the author tries to accept their own proposal", async () => {
    vi.mocked(conflictRepo.findCommentById).mockResolvedValue(
      makeComment({
        expectedOrderUpdatedAt: ORDER_UPDATED_AT,
        authorId: "ADMIN1", // same as adminCtx.user.id
      }) as unknown as Awaited<ReturnType<typeof conflictRepo.findCommentById>>,
    );

    await expect(acceptProposal(adminCtx, prisma, "C1")).rejects.toThrow(
      /your own proposal/i,
    );
    expect(orderRepo.updateOrder).not.toHaveBeenCalled();
  });

  it("rejects when proposal is already ACCEPTED (not PENDING)", async () => {
    vi.mocked(conflictRepo.findCommentById).mockResolvedValue(
      makeComment({
        expectedOrderUpdatedAt: ORDER_UPDATED_AT,
        status: "ACCEPTED",
      }) as unknown as Awaited<ReturnType<typeof conflictRepo.findCommentById>>,
    );

    await expect(acceptProposal(adminCtx, prisma, "C1")).rejects.toMatchObject({
      status: 409,
    });
    expect(orderRepo.updateOrder).not.toHaveBeenCalled();
  });

  it("SALES can accept an ADMIN proposal when expectedOrderUpdatedAt matches", async () => {
    // The reverse-direction acceptance flow — sales accepts admin's proposal.
    vi.mocked(conflictRepo.findConflictIssueById).mockResolvedValue({
      id: "ISSUE1",
      orderId: "O1",
      assigneeId: "SALES1", // sales is the assignee
      status: conflictRepo.ConflictIssueStatus.IN_DISCUSSION,
      order: { type: "Type A", updatedAt: ORDER_UPDATED_AT },
    });
    vi.mocked(conflictRepo.findCommentById).mockResolvedValue(
      makeComment({
        expectedOrderUpdatedAt: ORDER_UPDATED_AT,
        authorId: "ADMIN1", // admin authored
      }) as unknown as Awaited<ReturnType<typeof conflictRepo.findCommentById>>,
    );

    await expect(
      acceptProposal(salesCtx, prisma, "C1"),
    ).resolves.toBeUndefined();

    expect(conflictRepo.updateCommentProposalStatus).toHaveBeenCalledWith(
      prisma,
      "C1",
      "ACCEPTED",
    );
    // SALES path skips resolveActorScope entirely
    expect(scopeModule.resolveActorScope).not.toHaveBeenCalled();
  });
});
