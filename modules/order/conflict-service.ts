/**
 * modules/order/conflict-service.ts
 *
 * Business logic for conflict resolution flow.
 * - SALES: view own conflicts, add comments/proposals
 * - ADMIN/SUPERADMIN: view group conflicts, add comments, resolve or requeue
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
import {
  findConflictOrders,
  findConflictOrderById,
  createConflictComment,
  ConflictCommentType,
  type ConflictOrderRow,
  type ConflictOrderDetail,
  type ConflictCommentRow,
} from "@/infra/db/conflict-repository";

export type {
  ConflictOrderRow,
  ConflictOrderDetail,
  ConflictCommentRow,
  ConflictCommentType,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function conflictNotFound(): never {
  throw Object.assign(new Error("Conflict order not found."), {
    status: 404,
    code: "NOT_FOUND",
  });
}

async function assertConflictAccess(
  ctx: RequestContext,
  db: PrismaClient,
  orderId: string,
): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { applicantId: true, type: true, status: true },
  });

  if (!order || order.status !== "CONFLICT") conflictNotFound();

  if (ctx.user.role === "SALES") {
    if (order.applicantId !== ctx.user.id) conflictNotFound();
    return;
  }

  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  if (order.type !== getScopeGroup(scope)) conflictNotFound();
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export async function listConflicts(
  ctx: RequestContext,
  db: PrismaClient,
): Promise<ConflictOrderRow[]> {
  if (ctx.user.role === "SALES") {
    return findConflictOrders(db, { applicantId: ctx.user.id });
  }

  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  return findConflictOrders(db, { type: getScopeGroup(scope) });
}

export async function getConflict(
  ctx: RequestContext,
  db: PrismaClient,
  orderId: string,
): Promise<ConflictOrderDetail> {
  await assertConflictAccess(ctx, db, orderId);
  const detail = await findConflictOrderById(db, orderId);
  if (!detail) conflictNotFound();
  return detail;
}

export type AddCommentInput = {
  content: string;
  proposalData?: {
    newDueDate?: string;
    newQuantity?: number;
    targetFactoryNote?: string;
  };
};

export async function addComment(
  ctx: RequestContext,
  db: PrismaClient,
  orderId: string,
  input: AddCommentInput,
): Promise<ConflictCommentRow> {
  await assertConflictAccess(ctx, db, orderId);

  const isProposal =
    ctx.user.role === "SALES" &&
    input.proposalData !== undefined &&
    Object.keys(input.proposalData).length > 0;

  return createConflictComment(db, {
    orderId,
    authorId: ctx.user.id,
    content: input.content,
    type: isProposal
      ? ConflictCommentType.PROPOSAL
      : ConflictCommentType.COMMENT,
    proposalData: input.proposalData,
  });
}

export type ResolveInput = {
  applyProposal?: {
    newDueDate?: string;
    newQuantity?: number;
  };
  note?: string;
};

export async function resolveConflict(
  ctx: RequestContext,
  db: PrismaClient,
  orderId: string,
  input: ResolveInput,
): Promise<void> {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  await assertConflictAccess(ctx, db, orderId);

  const updateData: Record<string, unknown> = {
    status: "PENDING",
    lastModifiedById: ctx.user.id,
  };

  if (input.applyProposal?.newDueDate) {
    updateData.dueDate = new Date(input.applyProposal.newDueDate);
  }
  if (input.applyProposal?.newQuantity !== undefined) {
    updateData.quantity = input.applyProposal.newQuantity;
  }

  await db.order.update({ where: { id: orderId }, data: updateData });

  const hasProposalApplied =
    input.applyProposal &&
    (input.applyProposal.newDueDate ||
      input.applyProposal.newQuantity !== undefined);

  const content = hasProposalApplied
    ? `Resolution applied: ${input.note ?? "proposal accepted, order returned to pending queue."}`
    : `Order sent back to pending queue. ${input.note ?? ""}`.trim();

  await createConflictComment(db, {
    orderId,
    authorId: ctx.user.id,
    content,
    type: ConflictCommentType.RESOLUTION,
  });
}

export async function requeueConflict(
  ctx: RequestContext,
  db: PrismaClient,
  orderId: string,
  note?: string,
): Promise<void> {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  await assertConflictAccess(ctx, db, orderId);

  await db.order.update({
    where: { id: orderId },
    data: { status: "PENDING", lastModifiedById: ctx.user.id },
  });

  await createConflictComment(db, {
    orderId,
    authorId: ctx.user.id,
    content: note
      ? `Requeued for rescheduling: ${note}`
      : "Order requeued for rescheduling.",
    type: ConflictCommentType.REQUEUE,
  });
}
