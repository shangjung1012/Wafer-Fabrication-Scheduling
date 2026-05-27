/**
 * infra/db/conflict-issue-repository.ts
 *
 * All DB access for ConflictIssue, ConflictIssueComment, ConflictIssueEvent.
 * Business logic (RBAC, state machine, OCC) belongs in modules/order/conflict-issue-service.ts.
 */

import type { PrismaClient, Prisma } from "@/lib/generated/prisma";
import {
  ConflictIssueStatus,
  ConflictResolution,
  ConflictIssueEventType,
} from "@/lib/generated/prisma";

export { ConflictIssueStatus, ConflictResolution, ConflictIssueEventType };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictIssueRow = {
  id: string;
  number: number;
  orderId: string;
  orderName: string;
  orderType: string;
  title: string;
  status: ConflictIssueStatus;
  resolution: ConflictResolution | null;
  createdById: string;
  createdByUsername: string | null;
  assigneeId: string;
  assigneeUsername: string | null;
  assigneeEmail: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contextSnapshot: unknown;
  commentCount: number;
};

export type TimelineComment = {
  kind: "comment";
  id: string;
  issueId: string;
  authorId: string;
  authorUsername: string | null;
  authorEmail: string;
  authorRole: string;
  body: string;
  proposal: unknown;
  editedAt: Date | null;
  createdAt: Date;
};

export type TimelineEvent = {
  kind: "event";
  id: string;
  issueId: string;
  actorId: string;
  actorUsername: string | null;
  type: ConflictIssueEventType;
  payload: unknown;
  createdAt: Date;
};

export type TimelineItem = TimelineComment | TimelineEvent;

export type ConflictIssueDetail = ConflictIssueRow & {
  orderDueDate: Date;
  orderQuantity: number;
  orderStatus: string;
  orderUpdatedAt: Date;
  timeline: TimelineItem[];
};

export type CreateCommentInput = {
  issueId: string;
  authorId: string;
  body: string;
  proposal?: unknown;
};

export type UpdateCommentInput = {
  body: string;
};

export type CreateEventInput = {
  issueId: string;
  actorId: string;
  type: ConflictIssueEventType;
  payload?: unknown;
};

export type UpdateIssueInput = {
  status?: ConflictIssueStatus;
  resolution?: ConflictResolution | null;
  assigneeId?: string;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
};

export type CreateIssueInput = {
  orderId: string;
  title: string;
  status?: ConflictIssueStatus;
  resolution?: ConflictResolution | null;
  createdById: string;
  assigneeId: string;
  contextSnapshot: unknown;
};

export type IssueFilters = {
  statuses?: ConflictIssueStatus[];
  assigneeId?: string; // SALES: own issues
  orderType?: string; // ADMIN/SUPERADMIN: group filter
  createdById?: string;
};

// ---------------------------------------------------------------------------
// Select shapes
// ---------------------------------------------------------------------------

const issueBaseSelect = {
  id: true,
  number: true,
  orderId: true,
  order: {
    select: {
      name: true,
      type: true,
      dueDate: true,
      quantity: true,
      status: true,
    },
  },
  title: true,
  status: true,
  resolution: true,
  createdById: true,
  createdBy: { select: { username: true } },
  assigneeId: true,
  assignee: { select: { username: true, email: true } },
  resolvedAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
  contextSnapshot: true,
  _count: { select: { comments: true } },
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findConflictIssues(
  db: PrismaClient,
  filters: IssueFilters = {},
): Promise<ConflictIssueRow[]> {
  const rows = await db.conflictIssue.findMany({
    where: {
      ...(filters.statuses && filters.statuses.length > 0
        ? { status: { in: filters.statuses } }
        : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.orderType ? { order: { type: filters.orderType } } : {}),
      ...(filters.createdById ? { createdById: filters.createdById } : {}),
    },
    select: issueBaseSelect,
    orderBy: { updatedAt: "desc" },
  });

  return rows.map(toIssueRow);
}

export async function findConflictIssueByNumber(
  db: PrismaClient,
  number: number,
): Promise<ConflictIssueDetail | null> {
  const row = await db.conflictIssue.findUnique({
    where: { number },
    select: {
      ...issueBaseSelect,
      // Override order select to include updatedAt — required by the
      // proposal OCC check (see acceptProposal in conflict-issue-service.ts).
      order: {
        select: {
          name: true,
          type: true,
          dueDate: true,
          quantity: true,
          status: true,
          updatedAt: true,
        },
      },
      comments: {
        select: {
          id: true,
          issueId: true,
          authorId: true,
          author: { select: { username: true, email: true, role: true } },
          body: true,
          proposal: true,
          editedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      events: {
        select: {
          id: true,
          issueId: true,
          actorId: true,
          actor: { select: { username: true } },
          type: true,
          payload: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!row) return null;

  const comments: TimelineComment[] = row.comments.map((c) => ({
    kind: "comment" as const,
    id: c.id,
    issueId: c.issueId,
    authorId: c.authorId,
    authorUsername: c.author.username,
    authorEmail: c.author.email,
    authorRole: c.author.role,
    body: c.body,
    proposal: c.proposal,
    editedAt: c.editedAt,
    createdAt: c.createdAt,
  }));

  const events: TimelineEvent[] = row.events.map((e) => ({
    kind: "event" as const,
    id: e.id,
    issueId: e.issueId,
    actorId: e.actorId,
    actorUsername: e.actor.username,
    type: e.type,
    payload: e.payload,
    createdAt: e.createdAt,
  }));

  const timeline: TimelineItem[] = [...comments, ...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  return {
    ...toIssueRow(row),
    orderDueDate: row.order.dueDate,
    orderQuantity: row.order.quantity,
    orderStatus: row.order.status,
    orderUpdatedAt: row.order.updatedAt,
    timeline,
  };
}

export async function findConflictIssueById(
  db: PrismaClient,
  id: string,
): Promise<{
  id: string;
  orderId: string;
  assigneeId: string;
  status: ConflictIssueStatus;
  order: { type: string; updatedAt: Date };
} | null> {
  return db.conflictIssue.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      assigneeId: true,
      status: true,
      order: { select: { type: true, updatedAt: true } },
    },
  });
}

export async function findCommentById(db: PrismaClient, commentId: string) {
  return db.conflictIssueComment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      issueId: true,
      authorId: true,
      body: true,
      proposal: true,
      editedAt: true,
      createdAt: true,
      issue: {
        select: {
          id: true,
          orderId: true,
          assigneeId: true,
          status: true,
          order: {
            select: {
              type: true,
              updatedAt: true,
              quantity: true,
              dueDate: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Find an open (OPEN or IN_DISCUSSION) ConflictIssue for an order, if any.
 * Used for duplicate detection when auto-creating issues for failed orders.
 */
export async function findOpenIssueByOrderId(
  db: PrismaClient,
  orderId: string,
): Promise<{ id: string; status: ConflictIssueStatus } | null> {
  return db.conflictIssue.findFirst({
    where: {
      orderId,
      status: {
        in: [ConflictIssueStatus.OPEN, ConflictIssueStatus.IN_DISCUSSION],
      },
    },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createConflictIssue(
  db: PrismaClient,
  input: CreateIssueInput,
): Promise<{ id: string; number: number; createdAt: Date }> {
  return db.conflictIssue.create({
    data: {
      orderId: input.orderId,
      title: input.title,
      status: input.status ?? ConflictIssueStatus.OPEN,
      resolution: input.resolution ?? null,
      createdById: input.createdById,
      assigneeId: input.assigneeId,
      contextSnapshot: input.contextSnapshot as object,
    },
    select: { id: true, number: true, createdAt: true },
  });
}

export async function createManyConflictIssues(
  db: PrismaClient,
  data: Prisma.ConflictIssueCreateManyInput[],
): Promise<void> {
  if (data.length === 0) return;
  await db.conflictIssue.createMany({ data });
}

export async function findConflictIssuesByOrderIds(
  db: PrismaClient,
  orderIds: string[],
): Promise<{ id: string; orderId: string; number: number }[]> {
  if (orderIds.length === 0) return [];
  return db.conflictIssue.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, orderId: true, number: true },
  });
}

export async function createManyConflictIssueEvents(
  db: PrismaClient,
  data: Prisma.ConflictIssueEventCreateManyInput[],
): Promise<void> {
  if (data.length === 0) return;
  await db.conflictIssueEvent.createMany({ data });
}

export async function createConflictIssueComment(
  db: PrismaClient,
  input: CreateCommentInput,
): Promise<{ id: string; issueId: string; createdAt: Date }> {
  return db.conflictIssueComment.create({
    data: {
      issueId: input.issueId,
      authorId: input.authorId,
      body: input.body,
      proposal:
        input.proposal !== undefined ? (input.proposal as object) : undefined,
    },
    select: { id: true, issueId: true, createdAt: true },
  });
}

export async function updateConflictIssueComment(
  db: PrismaClient,
  commentId: string,
  input: UpdateCommentInput,
): Promise<void> {
  await db.conflictIssueComment.update({
    where: { id: commentId },
    data: { body: input.body, editedAt: new Date() },
  });
}

export async function updateCommentProposalStatus(
  db: PrismaClient,
  commentId: string,
  status: "ACCEPTED" | "REJECTED" | "STALE",
): Promise<void> {
  const comment = await db.conflictIssueComment.findUnique({
    where: { id: commentId },
    select: { proposal: true },
  });
  if (!comment?.proposal) return;

  const proposal = comment.proposal as Record<string, unknown>;
  await db.conflictIssueComment.update({
    where: { id: commentId },
    data: { proposal: { ...proposal, status } },
  });
}

/** Mark all other PENDING proposals on the same issue as STALE */
export async function staleOtherProposals(
  db: PrismaClient,
  issueId: string,
  exceptCommentId: string,
): Promise<void> {
  const others = await db.conflictIssueComment.findMany({
    where: { issueId, id: { not: exceptCommentId } },
    select: { id: true, proposal: true },
  });

  const updates = others
    .filter((c) => {
      const p = c.proposal as Record<string, unknown> | null;
      return p !== null && p.status === "PENDING";
    })
    .map((c) => {
      const p = c.proposal as Record<string, unknown>;
      return db.conflictIssueComment.update({
        where: { id: c.id },
        data: { proposal: { ...p, status: "STALE" } },
      });
    });

  if (updates.length > 0) {
    await db.$transaction(updates);
  }
}

export async function createConflictIssueEvent(
  db: PrismaClient,
  input: CreateEventInput,
): Promise<void> {
  await db.conflictIssueEvent.create({
    data: {
      issueId: input.issueId,
      actorId: input.actorId,
      type: input.type,
      payload:
        input.payload !== undefined ? (input.payload as object) : undefined,
    },
  });
}

export async function updateConflictIssue(
  db: PrismaClient,
  id: string,
  input: UpdateIssueInput,
): Promise<void> {
  await db.conflictIssue.update({ where: { id }, data: input });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type IssueBaseRow = {
  id: string;
  number: number;
  orderId: string;
  order: { name: string; type: string };
  title: string;
  status: ConflictIssueStatus;
  resolution: ConflictResolution | null;
  createdById: string;
  createdBy: { username: string | null };
  assigneeId: string;
  assignee: { username: string | null; email: string };
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contextSnapshot: unknown;
  _count: { comments: number };
};

function toIssueRow(row: IssueBaseRow): ConflictIssueRow {
  return {
    id: row.id,
    number: row.number,
    orderId: row.orderId,
    orderName: row.order.name,
    orderType: row.order.type,
    title: row.title,
    status: row.status,
    resolution: row.resolution,
    createdById: row.createdById,
    createdByUsername: row.createdBy.username,
    assigneeId: row.assigneeId,
    assigneeUsername: row.assignee.username,
    assigneeEmail: row.assignee.email,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    contextSnapshot: row.contextSnapshot,
    commentCount: row._count.comments,
  };
}
