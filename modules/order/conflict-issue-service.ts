/**
 * modules/order/conflict-issue-service.ts
 *
 * Business logic for ConflictIssue — RBAC, state machine, OCC.
 * All DB access delegates to infra/db/conflict-issue-repository.ts.
 */

import type { PrismaClient, Prisma } from "@/lib/generated/prisma";
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
  createManyConflictIssues,
  findConflictIssuesByOrderIds,
  createManyConflictIssueEvents,
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
import { findDailyCapacitiesByDateRange } from "@/infra/db/capacity-repository";
import { findUserById, findUsers } from "@/infra/db/user-repository";
import { getTime } from "@/lib/get-time";
import { calculateOrderDeadline } from "@/modules/schedule/validation-utils";
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
 * ADMIN → issues for orders in their production type group
 * SUPERADMIN → all types
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
  if (scope.role === "SUPERADMIN") {
    return { ...extra };
  }
  return { ...extra, orderType: getScopeGroup(scope) };
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
  if (scope.role !== "SUPERADMIN") {
    if (issue.order.type !== getScopeGroup(scope)) issueNotFound();
  }
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
  if (scope.role !== "SUPERADMIN") {
    if (issue.orderType !== getScopeGroup(scope)) issueNotFound();
  }
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

function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function assertValidSalesDelayDueDate(
  currentDueDate: Date,
  newDueDate: string,
  today: Date,
): void {
  const current = toIsoDateOnly(currentDueDate);
  if (newDueDate <= current) {
    throw Object.assign(
      new Error(
        "New due date must be later than the order's current due date.",
      ),
      { status: 400, code: "BAD_REQUEST" },
    );
  }
  const todayStr = toIsoDateOnly(today);
  if (newDueDate < todayStr) {
    throw Object.assign(new Error("New due date cannot be in the past."), {
      status: 400,
      code: "BAD_REQUEST",
    });
  }
}

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
    if (
      ctx.user.role === "SALES" &&
      input.proposal.kind === "DELAY_DUE_DATE" &&
      input.proposal.newDueDate
    ) {
      const order = await findOrderById(db, issue.orderId);
      if (!order) issueNotFound();
      assertValidSalesDelayDueDate(
        order.dueDate,
        input.proposal.newDueDate,
        await getTime(),
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
    const proposedDate = proposalData.proposal.newDueDate.slice(0, 10);
    if (proposedDate <= toIsoDateOnly(order.dueDate)) {
      throw Object.assign(
        new Error(
          "New due date must be later than the order's current due date.",
        ),
        { status: 400, code: "BAD_REQUEST" },
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
    const newAssignee = await findUserById(db, input.assigneeId);
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
    if (scope.role !== "SUPERADMIN") {
      if (issue.orderType !== getScopeGroup(scope)) issueNotFound();
    }
  }

  const snapshot = issue.contextSnapshot as {
    totalAvailableInWindow: number;
    requiredQuantity: number;
    windowStart: string;
    windowEnd: string;
    factoriesConsidered: Array<{ id: string; maxCapacity: number }>;
    orderSnapshot: { dueDate: string };
    config: { splittable: boolean; bufferDays: number; productionDays: number };
  };

  const originalDueDate = snapshot.orderSnapshot.dueDate;
  const requiredQty = snapshot.requiredQuantity;

  const isSplittable = snapshot.config?.splittable ?? true;
  const bufferDays = snapshot.config?.bufferDays ?? 0;
  const productionDays = snapshot.config?.productionDays ?? 0;

  const factories = snapshot.factoriesConsidered;
  const factoryIds = factories.map((f) => f.id);
  const factoryDefaults = new Map<string, number>(
    factories.map((f) => [f.id, f.maxCapacity]),
  );

  const trueWindowStart = new Date(snapshot.windowStart);
  const trueWindowEnd = new Date(snapshot.windowEnd);

  // ---------------------------------------------------------------------------
  // Dynamically compute capacity from trueWindowStart to scanEnd
  // ---------------------------------------------------------------------------
  const scanStart = new Date(trueWindowStart);
  const scanEnd = new Date(trueWindowEnd);
  scanEnd.setDate(scanEnd.getDate() + SEARCH_HORIZON_DAYS + 1); // +1 because original window is included

  const capacityRecords = await findDailyCapacitiesByDateRange(
    db,
    factoryIds,
    scanStart,
    scanEnd,
  );

  const capacityMap = new Map<string, number>();
  for (const rec of capacityRecords) {
    const dateKey = rec.date.toISOString().slice(0, 10);
    capacityMap.set(
      `${rec.factoryId}_${dateKey}`,
      Math.max(0, rec.curCapacity),
    );
  }

  // 1. Calculate live capacity in original window
  let liveTotalAvailableInWindow = 0;

  if (!isSplittable) {
    let maxSingleBlock = 0;
    const iterDate = new Date(trueWindowStart);
    while (iterDate.getTime() <= trueWindowEnd.getTime()) {
      const dateKey = iterDate.toISOString().slice(0, 10);
      for (const fid of factoryIds) {
        const mapKey = `${fid}_${dateKey}`;
        const cap = capacityMap.has(mapKey)
          ? capacityMap.get(mapKey)!
          : (factoryDefaults.get(fid) ?? 0);
        if (cap > maxSingleBlock) {
          maxSingleBlock = cap;
        }
      }
      iterDate.setDate(iterDate.getDate() + 1);
    }
    // Non-splittable max fit is bounded by the requiredQty
    liveTotalAvailableInWindow = Math.min(maxSingleBlock, requiredQty);
  } else {
    const iterDate = new Date(trueWindowStart);
    while (iterDate.getTime() <= trueWindowEnd.getTime()) {
      const dateKey = iterDate.toISOString().slice(0, 10);
      for (const fid of factoryIds) {
        const mapKey = `${fid}_${dateKey}`;
        const cap = capacityMap.has(mapKey)
          ? capacityMap.get(mapKey)!
          : (factoryDefaults.get(fid) ?? 0);
        liveTotalAvailableInWindow += cap;
      }
      iterDate.setDate(iterDate.getDate() + 1);
    }
  }

  // Scenario 1: maxFit
  const maxFitInOriginalWindow = {
    quantity: liveTotalAvailableInWindow,
    originalDueDate,
  };

  // Scenario 2: earliest date for original quantity
  // Scan day-by-day from windowEnd+1 until capacity >= requiredQty

  let cumulativeCapacity = isSplittable ? liveTotalAvailableInWindow : 0;
  let earliestFitForOriginalQty: EarliestFitResult = null;

  const futureScanStart = new Date(trueWindowEnd);
  futureScanStart.setDate(futureScanStart.getDate() + 1);
  futureScanStart.setHours(0, 0, 0, 0);

  const iterDate = new Date(futureScanStart);

  for (let day = 0; day < SEARCH_HORIZON_DAYS; day++) {
    const dateKey = iterDate.toISOString().slice(0, 10);

    let maxBlockForDay = 0;

    // Sum capacity across all relevant factories for this day
    let dayCapacity = 0;
    for (const fid of factoryIds) {
      const mapKey = `${fid}_${dateKey}`;
      const cap = capacityMap.has(mapKey)
        ? capacityMap.get(mapKey)!
        : (factoryDefaults.get(fid) ?? 0);

      dayCapacity += cap;
      if (cap > maxBlockForDay) maxBlockForDay = cap;
    }

    if (isSplittable) {
      cumulativeCapacity += dayCapacity;
      if (cumulativeCapacity >= requiredQty) {
        const foundProdDate = new Date(iterDate);

        // Convert found production date back to due date format by adding delays
        const newDueDate = new Date(foundProdDate);
        newDueDate.setDate(newDueDate.getDate() + productionDays + bufferDays);

        // calculate actual days delayed from the original due date
        const origDueDateObj = new Date(originalDueDate);
        const daysDelayed = Math.round(
          (newDueDate.getTime() - origDueDateObj.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        earliestFitForOriginalQty = {
          dueDate: newDueDate.toISOString().slice(0, 10),
          daysDelayed,
          searchHorizonDays: SEARCH_HORIZON_DAYS,
        };
        break;
      }
    } else {
      if (maxBlockForDay >= requiredQty) {
        const foundProdDate = new Date(iterDate);

        // Convert found production date back to due date format by adding delays
        const newDueDate = new Date(foundProdDate);
        newDueDate.setDate(newDueDate.getDate() + productionDays + bufferDays);

        // calculate actual days delayed from the original due date
        const origDueDateObj = new Date(originalDueDate);
        const daysDelayed = Math.round(
          (newDueDate.getTime() - origDueDateObj.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        earliestFitForOriginalQty = {
          dueDate: newDueDate.toISOString().slice(0, 10),
          daysDelayed,
          searchHorizonDays: SEARCH_HORIZON_DAYS,
        };
        break;
      }
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

export type CreateIssuesForFailedOrdersResult = {
  created: number;
  skippedAsDuplicate: number;
  failed: number;
};

export type IssueCreationPrep = {
  newIssuesData: Prisma.ConflictIssueCreateManyInput[];
  eventsData: Prisma.ConflictIssueEventCreateManyInput[];
  metadataMap: Map<
    string,
    {
      order: NonNullable<Awaited<ReturnType<typeof findOrderForIssueCreation>>>;
      deficit: number;
      contextSnapshot: Prisma.InputJsonValue;
      uniqueRecipients: Array<{ email: string; username: string | null }>;
    }
  >;
  createdCount: number;
  skippedCount: number;
};

/**
 * Phase 1 of issue creation: reads and data preparation.
 * Runs OUTSIDE the main DB transaction to avoid holding the connection
 * during sequential per-order queries.
 */
export async function prepareIssueCreationPrep(
  pr: PrismaClient,
  failedOrderIds: string[],
  actorId: string,
  runConfig: SchedulingConfig,
  runAt: Date,
  skipStatusCheck: boolean = false,
): Promise<IssueCreationPrep> {
  const createdCount = 0;
  let skippedCount = 0;

  const newIssuesData: Prisma.ConflictIssueCreateManyInput[] = [];
  const eventsData: Prisma.ConflictIssueEventCreateManyInput[] = [];
  const metadataMap: IssueCreationPrep["metadataMap"] = new Map();

  let cachedSuperAdminId: string | undefined = undefined;

  for (const orderId of failedOrderIds) {
    const order = await findOrderForIssueCreation(pr, orderId);
    if (!order) continue;
    if (!skipStatusCheck && order.status !== OrderStatus.FAILED) continue;

    const windowStart = new Date(runConfig.startDate);
    windowStart.setUTCHours(0, 0, 0, 0);
    const windowEnd = calculateOrderDeadline(order.dueDate, runConfig);
    windowEnd.setUTCHours(23, 59, 59, 999);

    const factories = await findFactoriesForIssueSnapshot(
      pr,
      order.type,
      windowStart,
      windowEnd,
    );

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

    const competingOrders = await findCompetingScheduledOrders(pr, {
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

    const existing = await findOpenIssueByOrderId(pr, order.id);
    if (existing) {
      eventsData.push({
        issueId: existing.id,
        actorId,
        type: ConflictIssueEventType.REPREVIEW_RAN,
        payload: {
          reason: "CAPACITY_CHANGED",
          snapshot: contextSnapshot,
        } as Prisma.InputJsonValue,
      });
      skippedCount += 1;
      continue;
    }

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
      if (cachedSuperAdminId === undefined) {
        const superAdmins = await findUsers(pr, { role: "SUPERADMIN" });
        cachedSuperAdminId = superAdmins.length > 0 ? superAdmins[0].id : "";
      }
      if (cachedSuperAdminId) assigneeId = cachedSuperAdminId;
    }

    if (!assigneeId) {
      throw new Error(
        `No assignee available for order ${order.id}. Failing chunk for rollback.`,
      );
    }

    newIssuesData.push({
      orderId: order.id,
      title: `Cannot schedule "${order.name}" — short by ${deficit} units`,
      status: ConflictIssueStatus.OPEN,
      createdById: actorId,
      assigneeId,
      contextSnapshot: contextSnapshot as Prisma.InputJsonValue,
    });

    const recipients: Array<{
      email: string;
      username: string | null;
    }> = [];
    if (order.applicant?.email)
      recipients.push({
        email: order.applicant.email,
        username: order.applicant.username,
      });
    for (const f of factories) {
      for (const admin of f.admins) {
        if (admin?.email)
          recipients.push({
            email: admin.email,
            username: admin.username,
          });
      }
    }

    const seenEmails = new Set<string>();
    const uniqueRecipients = recipients.filter((r) => {
      if (seenEmails.has(r.email)) return false;
      seenEmails.add(r.email);
      return true;
    });

    metadataMap.set(order.id, {
      order,
      deficit,
      contextSnapshot: contextSnapshot as Prisma.InputJsonValue,
      uniqueRecipients,
    });
  }

  return { newIssuesData, eventsData, metadataMap, createdCount, skippedCount };
}

/**
 * Phase 2+3 of issue creation: bulk writes and email prep.
 * Runs INSIDE the DB transaction. Accepts pre-computed data from
 * `prepareIssueCreationPrep` to avoid read-heavy connection holding.
 */
export async function createIssuesForFailedOrdersTx(
  pr: PrismaClient,
  failedOrderIds: string[],
  actorId: string,
  runConfig: SchedulingConfig,
  runAt: Date,
  prep?: IssueCreationPrep,
): Promise<{
  createdCount: number;
  skippedCount: number;
  emailsToDispatch: Array<() => Promise<void>>;
}> {
  const emailsToDispatch: Array<() => Promise<void>> = [];

  if (!prep) {
    prep = await prepareIssueCreationPrep(
      pr,
      failedOrderIds,
      actorId,
      runConfig,
      runAt,
    );
  }
  const { newIssuesData, eventsData, metadataMap, skippedCount } = prep;
  let { createdCount } = prep;

  // Phase 2: Bulk Insert Issues (createMany)
  if (newIssuesData.length > 0) {
    await createManyConflictIssues(pr, newIssuesData);
    createdCount += newIssuesData.length;

    // Fetch newly created issues to obtain DB-generated IDs and auto-incremented numbers
    const createdIssues = await findConflictIssuesByOrderIds(
      pr,
      newIssuesData.map((d) => d.orderId),
    );

    for (const issue of createdIssues) {
      const meta = metadataMap.get(issue.orderId);
      if (!meta) continue;

      // Attach OPENED event data
      eventsData.push({
        issueId: issue.id,
        actorId,
        type: ConflictIssueEventType.OPENED,
        payload: {
          snapshot: meta.contextSnapshot,
        } as Prisma.InputJsonValue,
      });

      // Prepare deferred email dispatches with DB-generated issue.number
      const dueDateString = toIsoDateOnly(meta.order.dueDate);
      const issueNumber = issue.number;

      meta.uniqueRecipients.forEach((r) => {
        emailsToDispatch.push(() =>
          renderAndSend(issueCreatedTemplate, {
            orderName: meta.order.name,
            orderQuantity: meta.order.quantity,
            dueDate: dueDateString,
            deficit: meta.deficit,
            issueNumber,
            recipientEmail: r.email,
            recipientUsername: r.username,
          }).catch((err) => {
            console.error(
              `[createIssuesForFailedOrders] Email failed for order ${meta.order.id} → ${r.email}:`,
              err,
            );
          }),
        );
      });
    }
  }

  // Phase 3: Bulk Insert Events
  if (eventsData.length > 0) {
    await createManyConflictIssueEvents(pr, eventsData);
  }

  return { createdCount, skippedCount, emailsToDispatch };
}

/**
 * Called fire-and-forget after a schedule transaction commits.
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

  // Process failed orders in chunks to prevent memory bloat and transaction timeouts
  const CHUNK_SIZE = 50;
  for (let i = 0; i < failedOrderIds.length; i += CHUNK_SIZE) {
    const chunk = failedOrderIds.slice(i, i + CHUNK_SIZE);

    try {
      const chunkResult = await db.$transaction(
        async (tx) => {
          return createIssuesForFailedOrdersTx(
            tx as unknown as PrismaClient,
            chunk,
            actorId,
            runConfig,
            runAt,
          );
        },
        { timeout: 15000 },
      );

      result.created += chunkResult.createdCount;
      result.skippedAsDuplicate += chunkResult.skippedCount;

      // Phase 4: Deferred Side-Effects (Execute emails only after transaction safely commits)
      if (chunkResult.emailsToDispatch.length > 0) {
        await Promise.allSettled(
          chunkResult.emailsToDispatch.map((fn) => fn()),
        );
      }
    } catch (err) {
      console.error(
        `[createIssuesForFailedOrders] Transaction failed for chunk. Rolling back.`,
        err,
      );
      result.failed += chunk.length;
    }
  }

  return result;
}
