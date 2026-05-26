/**
 * modules/order/conflict-issue-service.ts
 *
 * Business logic for ConflictIssue — RBAC, state machine, OCC.
 * All DB access delegates to infra/db/conflict-issue-repository.ts.
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
import {
  findConflictIssues,
  findConflictIssueByNumber,
  findConflictIssueById,
  findCommentById,
  createConflictIssue,
  createConflictIssueComment,
  updateConflictIssueComment,
  updateCommentProposalStatus,
  staleOtherProposals,
  createConflictIssueEvent,
  updateConflictIssue,
  findOpenIssueByOrderId,
  ConflictIssueStatus,
  ConflictResolution,
  ConflictIssueEventType,
  type ConflictIssueRow,
  type ConflictIssueDetail,
  type IssueFilters,
} from "@/infra/db/conflict-issue-repository";
import {
  updateOrder,
  OrderStatus,
  findOrderForIssueCreation,
  findCompetingScheduledOrders,
  findOrderById,
  deleteOrders,
} from "@/infra/db/order-repository";
import { findFactoriesForIssueSnapshot } from "@/infra/db/factory-repository";
import {
  computeTotalAvailableCapacity,
  type CapacityDraft,
  type SchedulingConfig,
} from "@/modules/schedule/strategy";
import { renderAndSend } from "@/modules/mail/mail-template";
import { issueCreatedTemplate } from "@/modules/mail/templates/issue-created";
import { cancelRequestTemplate } from "@/modules/mail/templates/cancel-request";

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

function issueNotFound(): never {
  throw Object.assign(new Error("Conflict issue not found."), {
    status: 404,
    code: "NOT_FOUND",
  });
}

function commentNotFound(): never {
  throw Object.assign(new Error("Comment not found."), {
    status: 404,
    code: "NOT_FOUND",
  });
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), {
    status: 409,
    code: "CONFLICT",
  });
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/**
 * Build DB filters based on the caller's role.
 * SALES  → only issues assigned to them
 * ADMIN / SUPERADMIN → issues for orders in their production type group
 */
async function buildFiltersForRole(
  ctx: RequestContext,
  db: PrismaClient,
  extra: IssueFilters = {},
): Promise<IssueFilters> {
  if (ctx.user.role === "SALES") {
    return { ...extra, assigneeId: ctx.user.id };
  }

  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  const group = getScopeGroup(scope);
  return { ...extra, orderType: group };
}

/**
 * Assert the caller has access to a specific issue.
 * Returns the issue, or throws 404 (to avoid info-leak).
 */
async function assertIssueAccess(
  ctx: RequestContext,
  db: PrismaClient,
  issueId: string,
) {
  const issue = await findConflictIssueById(db, issueId);
  if (!issue) issueNotFound();

  if (ctx.user.role === "SALES") {
    if (issue.assigneeId !== ctx.user.id) issueNotFound();
    return issue;
  }

  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  const group = getScopeGroup(scope);
  if (issue.order.type !== group) issueNotFound();
  return issue;
}

// ---------------------------------------------------------------------------
// Service: list
// ---------------------------------------------------------------------------

export async function listConflictIssues(
  ctx: RequestContext,
  db: PrismaClient,
  extra: IssueFilters = {},
): Promise<ConflictIssueRow[]> {
  const filters = await buildFiltersForRole(ctx, db, extra);
  return findConflictIssues(db, filters);
}

// ---------------------------------------------------------------------------
// Service: get by number
// ---------------------------------------------------------------------------

export async function getConflictIssue(
  ctx: RequestContext,
  db: PrismaClient,
  number: number,
): Promise<ConflictIssueDetail> {
  const issue = await findConflictIssueByNumber(db, number);
  if (!issue) issueNotFound();

  // Access check
  if (ctx.user.role === "SALES") {
    if (issue.assigneeId !== ctx.user.id) issueNotFound();
    return issue;
  }

  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  const group = getScopeGroup(scope);
  if (issue.orderType !== group) issueNotFound();
  return issue;
}

// ---------------------------------------------------------------------------
// Service: add comment
// ---------------------------------------------------------------------------

export type AddCommentInput = {
  body: string;
  proposal?: {
    kind: "REDUCE_QUANTITY" | "DELAY_DUE_DATE" | "CANCEL";
    newQuantity?: number;
    newDueDate?: string;
  };
  expectedOrderUpdatedAt?: string; // required when proposal is present
};

export async function addComment(
  ctx: RequestContext,
  db: PrismaClient,
  issueId: string,
  input: AddCommentInput,
): Promise<{ id: string; issueId: string; createdAt: Date }> {
  await assertIssueAccess(ctx, db, issueId);
  const issue = await findConflictIssueById(db, issueId);
  if (!issue) issueNotFound();

  if (
    issue.status === ConflictIssueStatus.RESOLVED ||
    issue.status === ConflictIssueStatus.CLOSED
  ) {
    throw new ForbiddenError(
      "Cannot add comments to a resolved or closed issue.",
    );
  }

  // Build proposal payload if provided
  let proposalPayload: object | undefined;
  if (input.proposal) {
    if (!input.expectedOrderUpdatedAt) {
      throw Object.assign(
        new Error(
          "expectedOrderUpdatedAt is required when attaching a proposal.",
        ),
        { status: 400, code: "BAD_REQUEST" },
      );
    }
    proposalPayload = {
      proposal: input.proposal,
      expectedOrderUpdatedAt: input.expectedOrderUpdatedAt,
      status: "PENDING",
    };
  }

  const comment = await createConflictIssueComment(db, {
    issueId,
    authorId: ctx.user.id,
    body: input.body,
    proposal: proposalPayload,
  });

  // Transition OPEN → IN_DISCUSSION on first comment
  if (issue.status === ConflictIssueStatus.OPEN) {
    await updateConflictIssue(db, issueId, {
      status: ConflictIssueStatus.IN_DISCUSSION,
    });
  }

  return comment;
}

// ---------------------------------------------------------------------------
// Service: edit comment
// ---------------------------------------------------------------------------

export async function editComment(
  ctx: RequestContext,
  db: PrismaClient,
  commentId: string,
  input: { body: string },
): Promise<void> {
  const comment = await findCommentById(db, commentId);
  if (!comment) commentNotFound();

  // Author-only
  if (comment.authorId !== ctx.user.id) {
    throw new ForbiddenError("You can only edit your own comments.");
  }

  await updateConflictIssueComment(db, commentId, { body: input.body });
}

// ---------------------------------------------------------------------------
// Service: accept proposal
// ---------------------------------------------------------------------------

export async function acceptProposal(
  ctx: RequestContext,
  db: PrismaClient,
  commentId: string,
): Promise<void> {
  const comment = await findCommentById(db, commentId);
  if (!comment) commentNotFound();

  const issueId = comment.issueId;
  await assertIssueAccess(ctx, db, issueId);

  // Cannot accept your own proposal
  if (comment.authorId === ctx.user.id) {
    throw new ForbiddenError("You cannot accept your own proposal.");
  }

  if (!comment.proposal) {
    throw Object.assign(new Error("This comment has no proposal."), {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  const proposalData = comment.proposal as {
    proposal: {
      kind: "REDUCE_QUANTITY" | "DELAY_DUE_DATE" | "CANCEL";
      newQuantity?: number;
      newDueDate?: string;
    };
    expectedOrderUpdatedAt: string;
    status: string;
  };

  if (proposalData.status !== "PENDING") {
    throw Object.assign(
      new Error(`Proposal is already ${proposalData.status.toLowerCase()}.`),
      { status: 409, code: "CONFLICT" },
    );
  }

  // OCC check: Order.updatedAt must match expectedOrderUpdatedAt
  const order = comment.issue.order;
  const expected = new Date(proposalData.expectedOrderUpdatedAt).getTime();
  const actual = order.updatedAt.getTime();
  if (expected !== actual) {
    // Mark this proposal as STALE
    await updateCommentProposalStatus(db, commentId, "STALE");
    conflict(
      "The order was modified after this proposal was created. The proposal has been marked stale. Please review the latest state and submit a new proposal.",
    );
  }

  // Compute safe fields and resolution from proposal kind
  const safeFields: Record<string, unknown> = {
    lastModifiedById: ctx.user.id,
    status: OrderStatus.PENDING, // return to schedulable state
  };
  let resolution: ConflictResolution;

  const kind = proposalData.proposal.kind;
  if (kind === "REDUCE_QUANTITY") {
    if (!proposalData.proposal.newQuantity) {
      throw Object.assign(
        new Error("newQuantity is required for REDUCE_QUANTITY proposal."),
        {
          status: 400,
          code: "BAD_REQUEST",
        },
      );
    }
    safeFields.quantity = proposalData.proposal.newQuantity;
    resolution = ConflictResolution.REDUCED_QUANTITY;
  } else if (kind === "DELAY_DUE_DATE") {
    if (!proposalData.proposal.newDueDate) {
      throw Object.assign(
        new Error("newDueDate is required for DELAY_DUE_DATE proposal."),
        {
          status: 400,
          code: "BAD_REQUEST",
        },
      );
    }
    safeFields.dueDate = new Date(proposalData.proposal.newDueDate);
    resolution = ConflictResolution.DELAYED_DUE_DATE;
  } else if (kind === "CANCEL") {
    safeFields.status = OrderStatus.CANCELLED;
    resolution = ConflictResolution.CANCELLED;
  } else {
    throw Object.assign(new Error("Unknown proposal kind."), {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  // Snapshot before/after for the ORDER_UPDATED event
  const orderBefore = {
    quantity: order.quantity,
    dueDate: order.dueDate,
    status: comment.issue.status,
  };

  // Apply changes to the order
  await updateOrder(
    db,
    comment.issue.orderId,
    safeFields as Parameters<typeof updateOrder>[2],
  );

  // Fetch updated order for after snapshot
  const orderAfter = {
    quantity:
      kind === "REDUCE_QUANTITY"
        ? proposalData.proposal.newQuantity
        : order.quantity,
    dueDate:
      kind === "DELAY_DUE_DATE"
        ? proposalData.proposal.newDueDate
        : order.dueDate,
    status: kind === "CANCEL" ? "CANCELLED" : "PENDING",
  };

  // Mark the accepted proposal
  await updateCommentProposalStatus(db, commentId, "ACCEPTED");

  // Stale all other PENDING proposals on this issue
  await staleOtherProposals(db, issueId, commentId);

  // Write events
  await createConflictIssueEvent(db, {
    issueId,
    actorId: ctx.user.id,
    type: ConflictIssueEventType.ORDER_UPDATED,
    payload: { before: orderBefore, after: orderAfter, commentId },
  });
  await createConflictIssueEvent(db, {
    issueId,
    actorId: ctx.user.id,
    type: ConflictIssueEventType.PROPOSAL_ACCEPTED,
    payload: { commentId, proposalKind: kind },
  });
  await createConflictIssueEvent(db, {
    issueId,
    actorId: ctx.user.id,
    type: ConflictIssueEventType.RESOLVED,
    payload: { resolution },
  });

  // Mark issue as RESOLVED
  await updateConflictIssue(db, issueId, {
    status: ConflictIssueStatus.RESOLVED,
    resolution,
    resolvedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Service: reject proposal
// ---------------------------------------------------------------------------

export async function rejectProposal(
  ctx: RequestContext,
  db: PrismaClient,
  commentId: string,
): Promise<void> {
  const comment = await findCommentById(db, commentId);
  if (!comment) commentNotFound();

  const issueId = comment.issueId;
  await assertIssueAccess(ctx, db, issueId);

  // Cannot reject your own proposal
  if (comment.authorId === ctx.user.id) {
    throw new ForbiddenError("You cannot reject your own proposal.");
  }

  if (!comment.proposal) {
    throw Object.assign(new Error("This comment has no proposal."), {
      status: 400,
      code: "BAD_REQUEST",
    });
  }

  const proposalData = comment.proposal as { status: string };
  if (proposalData.status !== "PENDING") {
    throw Object.assign(
      new Error(`Proposal is already ${proposalData.status.toLowerCase()}.`),
      { status: 409, code: "CONFLICT" },
    );
  }

  await updateCommentProposalStatus(db, commentId, "REJECTED");
  await createConflictIssueEvent(db, {
    issueId,
    actorId: ctx.user.id,
    type: ConflictIssueEventType.PROPOSAL_REJECTED,
    payload: { commentId },
  });
}

// ---------------------------------------------------------------------------
// Service: update issue status (admin actions)
// ---------------------------------------------------------------------------

export type UpdateIssueStatusInput =
  | { action: "CLOSE" }
  | { action: "REOPEN" }
  | { action: "REASSIGN"; assigneeId: string }
  | { action: "CANCEL_ORDER" };

export async function updateIssueStatus(
  ctx: RequestContext,
  db: PrismaClient,
  issueId: string,
  input: UpdateIssueStatusInput,
): Promise<void> {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  await assertIssueAccess(ctx, db, issueId);

  const issue = await findConflictIssueById(db, issueId);
  if (!issue) issueNotFound();

  if (input.action === "CLOSE") {
    if (issue.status === ConflictIssueStatus.CLOSED) {
      throw Object.assign(new Error("Issue is already closed."), {
        status: 409,
        code: "CONFLICT",
      });
    }
    await updateConflictIssue(db, issueId, {
      status: ConflictIssueStatus.CLOSED,
      resolution: ConflictResolution.WONT_FIX,
      closedAt: new Date(),
    });
    await createConflictIssueEvent(db, {
      issueId,
      actorId: ctx.user.id,
      type: ConflictIssueEventType.CLOSED,
    });
  } else if (input.action === "REOPEN") {
    if (
      issue.status !== ConflictIssueStatus.CLOSED &&
      issue.status !== ConflictIssueStatus.RESOLVED
    ) {
      throw Object.assign(
        new Error("Only closed or resolved issues can be reopened."),
        {
          status: 409,
          code: "CONFLICT",
        },
      );
    }
    await updateConflictIssue(db, issueId, {
      status: ConflictIssueStatus.IN_DISCUSSION,
      resolution: null,
      resolvedAt: null,
      closedAt: null,
    });
    await createConflictIssueEvent(db, {
      issueId,
      actorId: ctx.user.id,
      type: ConflictIssueEventType.REOPENED,
    });
  } else if (input.action === "REASSIGN") {
    const newAssignee = await db.user.findUnique({
      where: { id: input.assigneeId },
      select: { id: true, role: true },
    });
    if (!newAssignee || newAssignee.role !== "SALES") {
      throw Object.assign(new Error("Assignee must be a SALES user."), {
        status: 400,
        code: "BAD_REQUEST",
      });
    }
    await updateConflictIssue(db, issueId, { assigneeId: input.assigneeId });
    await createConflictIssueEvent(db, {
      issueId,
      actorId: ctx.user.id,
      type: ConflictIssueEventType.REASSIGNED,
      payload: { newAssigneeId: input.assigneeId },
    });
  } else if (input.action === "CANCEL_ORDER") {
    if (
      issue.status === ConflictIssueStatus.RESOLVED ||
      issue.status === ConflictIssueStatus.CLOSED
    ) {
      conflict("Cannot cancel order on a resolved or closed issue.");
    }
    await deleteOrders(db, [issue.orderId]);
    await updateConflictIssue(db, issueId, {
      status: ConflictIssueStatus.CLOSED,
      resolution: ConflictResolution.CANCELLED,
      closedAt: new Date(),
    });
    await createConflictIssueEvent(db, {
      issueId,
      actorId: ctx.user.id,
      type: ConflictIssueEventType.CLOSED,
      payload: { resolution: ConflictResolution.CANCELLED },
    });
  }
}

// ---------------------------------------------------------------------------
// Service: create cancellation request (Sales)
// ---------------------------------------------------------------------------

export async function createCancellationRequest(
  ctx: RequestContext,
  db: PrismaClient,
  orderId: string,
): Promise<{ issueId: string; issueNumber: number }> {
  requireRole(ctx, ["SALES"]);

  const order = await findOrderById(db, orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found."), {
      status: 404,
      code: "NOT_FOUND",
    });
  }

  if (order.applicantId !== ctx.user.id) {
    throw new ForbiddenError("You can only flag your own orders.");
  }

  if (
    order.status !== OrderStatus.PENDING &&
    order.status !== OrderStatus.SCHEDULED
  ) {
    throw Object.assign(
      new Error(
        "Only PENDING or SCHEDULED orders can be flagged for cancellation.",
      ),
      { status: 409, code: "CONFLICT" },
    );
  }

  const existing = await findOpenIssueByOrderId(db, orderId);
  if (existing) {
    conflict(
      "A cancellation request is already open for this order. Review the existing issue.",
    );
  }

  const created = await createConflictIssue(db, {
    orderId,
    title: `Cancellation Request: "${order.name}"`,
    status: ConflictIssueStatus.OPEN,
    resolution: null,
    createdById: ctx.user.id,
    assigneeId: ctx.user.id,
    contextSnapshot: {},
  });

  await createConflictIssueEvent(db, {
    issueId: created.id,
    actorId: ctx.user.id,
    type: ConflictIssueEventType.OPENED,
    payload: { reason: "CANCEL_REQUEST" },
  });

  // Notify admins of the relevant production type
  const now = new Date();
  const factories = await findFactoriesForIssueSnapshot(
    db,
    order.type,
    now,
    now,
  );
  const adminRecipients: Array<{ email: string; username: string | null }> = [];
  for (const f of factories) {
    for (const admin of f.admins) {
      if (admin?.email) {
        adminRecipients.push({ email: admin.email, username: admin.username });
      }
    }
  }

  const seenEmails = new Set<string>();
  const uniqueAdmins = adminRecipients.filter((r) => {
    if (seenEmails.has(r.email)) return false;
    seenEmails.add(r.email);
    return true;
  });

  await Promise.allSettled(
    uniqueAdmins.map((r) =>
      renderAndSend(cancelRequestTemplate, {
        orderName: order.name,
        issueNumber: created.number,
        requesterUsername: ctx.user.username ?? null,
        recipientEmail: r.email,
        recipientUsername: r.username,
      }),
    ),
  );

  return { issueId: created.id, issueNumber: created.number };
}

// ---------------------------------------------------------------------------
// Service: suggestions
// ---------------------------------------------------------------------------

type EarliestFitResult = {
  dueDate: string | null;
  daysDelayed: number;
  searchHorizonDays: number;
} | null;

export type SuggestionsResult = {
  computedAt: string;
  scenarios: {
    maxFitInOriginalWindow: {
      quantity: number;
      originalDueDate: string;
    };
    earliestFitForOriginalQty: EarliestFitResult;
  };
  caveat: string;
};

const SEARCH_HORIZON_DAYS = 90;

export async function getSuggestions(
  ctx: RequestContext,
  db: PrismaClient,
  number: number,
): Promise<SuggestionsResult> {
  const issue = await findConflictIssueByNumber(db, number);
  if (!issue) issueNotFound();

  // Access check
  if (ctx.user.role === "SALES") {
    if (issue.assigneeId !== ctx.user.id) issueNotFound();
  } else {
    requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
    const scope = await resolveActorScope(ctx, db);
    const group = getScopeGroup(scope);
    if (issue.orderType !== group) issueNotFound();
  }

  const snapshot = issue.contextSnapshot as {
    totalAvailableInWindow: number;
    requiredQuantity: number;
    windowStart: string;
    windowEnd: string;
    factoriesConsidered: Array<{ id: string; maxCapacity: number }>;
    orderSnapshot: { dueDate: string };
  };

  const originalDueDate = snapshot.orderSnapshot.dueDate;
  const requiredQty = snapshot.requiredQuantity;
  const totalAvailableInWindow = snapshot.totalAvailableInWindow;

  // Scenario 1: maxFit is already in the snapshot — no DB query needed
  const maxFitInOriginalWindow = {
    quantity: totalAvailableInWindow,
    originalDueDate,
  };

  // Scenario 2: earliest date for original quantity
  // Scan day-by-day from dueDate+1 until cumulative available >= requiredQty
  const factories = snapshot.factoriesConsidered;
  const factoryIds = factories.map((f) => f.id);

  // Fetch all DailyCapacity records for the scan window
  const scanStart = new Date(originalDueDate);
  scanStart.setDate(scanStart.getDate() + 1);
  scanStart.setHours(0, 0, 0, 0);

  const scanEnd = new Date(scanStart);
  scanEnd.setDate(scanEnd.getDate() + SEARCH_HORIZON_DAYS);

  const capacityRecords = await db.dailyCapacity.findMany({
    where: {
      factoryId: { in: factoryIds },
      date: { gte: scanStart, lte: scanEnd },
    },
    select: {
      factoryId: true,
      date: true,
      curCapacity: true,
      maxCapacity: true,
    },
  });

  // Build a lookup map: `${factoryId}_${YYYY-MM-DD}` → curCapacity
  const capacityMap = new Map<string, number>();
  for (const rec of capacityRecords) {
    const dateKey = rec.date.toISOString().slice(0, 10);
    capacityMap.set(
      `${rec.factoryId}_${dateKey}`,
      Math.max(0, rec.curCapacity),
    );
  }

  // Factory default capacities
  const factoryDefaults = new Map<string, number>(
    factories.map((f) => [f.id, f.maxCapacity]),
  );

  // Day-by-day scan
  let cumulativeCapacity = 0;
  let earliestFitForOriginalQty: EarliestFitResult = null;
  const iterDate = new Date(scanStart);

  for (let day = 0; day < SEARCH_HORIZON_DAYS; day++) {
    const dateKey = iterDate.toISOString().slice(0, 10);

    // Sum capacity across all relevant factories for this day
    let dayCapacity = 0;
    for (const fid of factoryIds) {
      const mapKey = `${fid}_${dateKey}`;
      if (capacityMap.has(mapKey)) {
        dayCapacity += capacityMap.get(mapKey)!;
      } else {
        dayCapacity += factoryDefaults.get(fid) ?? 0;
      }
    }

    cumulativeCapacity += dayCapacity;

    if (cumulativeCapacity >= requiredQty) {
      earliestFitForOriginalQty = {
        dueDate: dateKey,
        daysDelayed: day + 1,
        searchHorizonDays: SEARCH_HORIZON_DAYS,
      };
      break;
    }

    iterDate.setDate(iterDate.getDate() + 1);
  }

  // If we scanned the entire horizon without finding a fit
  if (!earliestFitForOriginalQty) {
    earliestFitForOriginalQty = {
      dueDate: null,
      daysDelayed: SEARCH_HORIZON_DAYS,
      searchHorizonDays: SEARCH_HORIZON_DAYS,
    };
  }

  return {
    computedAt: new Date().toISOString(),
    scenarios: {
      maxFitInOriginalWindow,
      earliestFitForOriginalQty,
    },
    caveat: "估算基於目前產能；新訂單進來可能改變結果。Accept 時會再次驗證。",
  };
}

// ---------------------------------------------------------------------------
// Service: auto-create issues for newly-FAILED orders
// ---------------------------------------------------------------------------

/**
 * Format a Date as YYYY-MM-DD using UTC slicing on the ISO string.
 * Matches the convention used by the strategy engine's date keys.
 */
function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CreateIssuesForFailedOrdersResult = {
  created: number;
  skippedAsDuplicate: number;
  failed: number;
};

/**
 * Called fire-and-forget after a schedule transaction commits.
 *
 * For each id in `failedOrderIds`:
 *  - Skip if the order is no longer FAILED (race-safety).
 *  - If an OPEN / IN_DISCUSSION ConflictIssue already exists for the order:
 *    append a system event (capacity changed) and do NOT email or create a new
 *    issue.
 *  - Otherwise: compute a contextSnapshot, insert a ConflictIssue, and email
 *    the applicant + the order's factory admins.
 *
 * Never throws. All per-order failures are caught and logged; returns the
 * aggregate counts so the caller can include them in structured logs.
 */
export async function createIssuesForFailedOrders(input: {
  failedOrderIds: string[];
  actorId: string;
  runConfig: SchedulingConfig;
  runAt: Date;
  prisma: PrismaClient;
}): Promise<CreateIssuesForFailedOrdersResult> {
  const { failedOrderIds, actorId, runConfig, runAt, prisma: db } = input;

  const result: CreateIssuesForFailedOrdersResult = {
    created: 0,
    skippedAsDuplicate: 0,
    failed: 0,
  };

  for (const orderId of failedOrderIds) {
    try {
      const order = await findOrderForIssueCreation(db, orderId);
      if (!order) {
        console.warn(
          `[createIssuesForFailedOrders] Order ${orderId} not found; skipping.`,
        );
        continue;
      }

      // Defensive: only act on orders that are still FAILED.
      if (order.status !== OrderStatus.FAILED) {
        continue;
      }

      // -------------------------------------------------------------------
      // Snapshot — window, factories, capacity, competing orders
      // -------------------------------------------------------------------
      const windowStart = new Date(runConfig.startDate);
      windowStart.setHours(0, 0, 0, 0);
      const windowEnd = new Date(order.dueDate);
      windowEnd.setHours(23, 59, 59, 999);

      const factories = await findFactoriesForIssueSnapshot(
        db,
        order.type,
        windowStart,
        windowEnd,
      );

      // Build a CapacityDraft map keyed by `${factoryId}_${YYYY-MM-DD}`.
      const capacityMap = new Map<string, CapacityDraft>();
      for (const f of factories) {
        for (const cap of f.dailyCapacities) {
          const dateKey = toIsoDateOnly(cap.date);
          capacityMap.set(`${f.id}_${dateKey}`, {
            id: cap.id,
            factoryId: cap.factoryId,
            date: cap.date,
            maxCapacity: cap.maxCapacity,
            curCapacity: cap.curCapacity,
          });
        }
      }

      const factoryInputs = factories.map((f) => ({
        id: f.id,
        maxCapacity: f.maxCapacity,
      }));

      const totalAvailableInWindow = computeTotalAvailableCapacity(
        windowStart,
        windowEnd,
        factoryInputs,
        capacityMap,
      );

      const requiredQuantity = order.quantity;
      const deficit = Math.max(0, requiredQuantity - totalAvailableInWindow);

      const competingOrders = await findCompetingScheduledOrders(db, {
        factoryIds: factories.map((f) => f.id),
        windowStart,
        windowEnd,
        excludeOrderId: order.id,
      });

      const contextSnapshot = {
        previewRunAt: runAt.toISOString(),
        reschedulePolicy: runConfig.reschedulePolicy,
        config: {
          frozenDays: runConfig.frozenDays,
          productionDays: runConfig.productionDays,
          bufferDays: runConfig.bufferDays,
          splittable: runConfig.splittable,
        },
        windowStart: toIsoDateOnly(windowStart),
        windowEnd: toIsoDateOnly(windowEnd),
        requiredQuantity,
        totalAvailableInWindow,
        deficit,
        factoriesConsidered: factories.map((f) => ({
          id: f.id,
          productionType: f.productionType,
          maxCapacity: f.maxCapacity,
        })),
        orderSnapshot: {
          quantity: order.quantity,
          dueDate: order.dueDate.toISOString(),
          status: order.status,
          updatedAt: order.updatedAt.toISOString(),
        },
        competingOrders,
      };

      // -------------------------------------------------------------------
      // Duplicate detection: existing OPEN / IN_DISCUSSION issue
      // -------------------------------------------------------------------
      const existing = await findOpenIssueByOrderId(db, order.id);
      if (existing) {
        // No CAPACITY_CHANGED enum value exists in ConflictIssueEventType
        // (schema unchanged in P1; see proposal §2.4 / §3.3). REPREVIEW_RAN
        // is the closest existing event — re-use it with the snapshot as
        // payload so the timeline still records the recurrence.
        try {
          await createConflictIssueEvent(db, {
            issueId: existing.id,
            actorId,
            type: ConflictIssueEventType.REPREVIEW_RAN,
            payload: { reason: "CAPACITY_CHANGED", snapshot: contextSnapshot },
          });
        } catch (err) {
          console.error(
            `[createIssuesForFailedOrders] Failed to append event to issue ${existing.id} for order ${order.id}:`,
            err,
          );
        }
        result.skippedAsDuplicate += 1;
        continue;
      }

      // -------------------------------------------------------------------
      // Assignee resolution: applicant first, otherwise a factory admin
      // -------------------------------------------------------------------
      let assigneeId: string | null = order.applicantId ?? null;
      if (!assigneeId) {
        const firstAdmin = factories
          .flatMap((f) => f.admins)
          .find((a) => !!a?.id);
        if (firstAdmin?.id) {
          assigneeId = firstAdmin.id;
        }
      }

      if (!assigneeId) {
        console.error(
          `[createIssuesForFailedOrders] No assignee available for order ${order.id} — neither applicant nor any factory admin. Skipping.`,
        );
        result.failed += 1;
        continue;
      }

      // -------------------------------------------------------------------
      // Create the issue
      // -------------------------------------------------------------------
      let issueId: string;
      let issueNumber: number;
      try {
        const created = await createConflictIssue(db, {
          orderId: order.id,
          title: `Cannot schedule "${order.name}" — short by ${deficit} units`,
          status: ConflictIssueStatus.OPEN,
          resolution: null,
          createdById: actorId,
          assigneeId,
          contextSnapshot,
        });
        issueId = created.id;
        issueNumber = created.number;
      } catch (err) {
        console.error(
          `[createIssuesForFailedOrders] Failed to create ConflictIssue for order ${order.id}:`,
          err,
        );
        result.failed += 1;
        continue;
      }

      // Record OPENED event (parallels manual creation flow).
      try {
        await createConflictIssueEvent(db, {
          issueId,
          actorId,
          type: ConflictIssueEventType.OPENED,
          payload: { snapshot: contextSnapshot },
        });
      } catch (err) {
        // Non-fatal — issue row exists, timeline event is best-effort.
        console.error(
          `[createIssuesForFailedOrders] Failed to write OPENED event for order ${order.id}:`,
          err,
        );
      }

      result.created += 1;

      // -------------------------------------------------------------------
      // Send notification emails (applicant + factory admins). Failures here
      // are logged but never bubble up — the issue itself was created.
      // -------------------------------------------------------------------
      const recipients: Array<{ email: string; username: string | null }> = [];
      if (order.applicant?.email) {
        recipients.push({
          email: order.applicant.email,
          username: order.applicant.username,
        });
      }
      for (const f of factories) {
        for (const admin of f.admins) {
          if (admin?.email) {
            recipients.push({ email: admin.email, username: admin.username });
          }
        }
      }

      // Deduplicate by email
      const seenEmails = new Set<string>();
      const uniqueRecipients = recipients.filter((r) => {
        if (seenEmails.has(r.email)) return false;
        seenEmails.add(r.email);
        return true;
      });

      const dueDateString = toIsoDateOnly(order.dueDate);
      const sendResults = await Promise.allSettled(
        uniqueRecipients.map((r) =>
          renderAndSend(issueCreatedTemplate, {
            orderName: order.name,
            orderQuantity: order.quantity,
            dueDate: dueDateString,
            deficit,
            issueNumber,
            recipientEmail: r.email,
            recipientUsername: r.username,
          }),
        ),
      );
      sendResults.forEach((res, i) => {
        if (res.status === "rejected") {
          console.error(
            `[createIssuesForFailedOrders] Email failed for order ${order.id} → ${uniqueRecipients[i].email}:`,
            res.reason,
          );
        }
      });
    } catch (err) {
      console.error(
        `[createIssuesForFailedOrders] Unexpected error processing order ${orderId}:`,
        err,
      );
      result.failed += 1;
    }
  }

  return result;
}
