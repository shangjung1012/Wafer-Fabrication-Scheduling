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
  createConflictIssueComment,
  updateConflictIssueComment,
  updateCommentProposalStatus,
  staleOtherProposals,
  createConflictIssueEvent,
  updateConflictIssue,
  ConflictIssueStatus,
  ConflictResolution,
  ConflictIssueEventType,
  type ConflictIssueRow,
  type ConflictIssueDetail,
  type IssueFilters,
} from "@/infra/db/conflict-issue-repository";
import { updateOrder, OrderStatus } from "@/infra/db/order-repository";

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

export type UpdateIssueStatusInput = {
  action: "CLOSE" | "REOPEN" | "REASSIGN";
  assigneeId?: string; // required for REASSIGN
};

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
    if (!input.assigneeId) {
      throw Object.assign(
        new Error("assigneeId is required for REASSIGN action."),
        {
          status: 400,
          code: "BAD_REQUEST",
        },
      );
    }
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
  }
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
