/**
 * infra/db/conflict-repository.ts
 *
 * All DB access for ConflictComment and conflict-related Order queries.
 * Business logic (RBAC, scope) belongs in modules/order/conflict-service.ts.
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import { ConflictCommentType } from "@/lib/generated/prisma";

export { ConflictCommentType };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictCommentRow = {
  id: string;
  orderId: string;
  authorId: string;
  authorUsername: string | null;
  authorRole: string;
  content: string;
  type: ConflictCommentType;
  proposalData: unknown;
  createdAt: Date;
};

export type ConflictOrderRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: Date;
  quantity: number;
  applicantId: string;
  applicantUsername: string | null;
  applicantEmail: string;
  lastModifiedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  commentCount: number;
};

export type ConflictOrderDetail = ConflictOrderRow & {
  comments: ConflictCommentRow[];
};

export type CreateCommentInput = {
  orderId: string;
  authorId: string;
  content: string;
  type: ConflictCommentType;
  proposalData?: unknown;
};

// ---------------------------------------------------------------------------
// Select shapes
// ---------------------------------------------------------------------------

const commentSelect = {
  id: true,
  orderId: true,
  authorId: true,
  author: { select: { username: true, role: true } },
  content: true,
  type: true,
  proposalData: true,
  createdAt: true,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findConflictOrders(
  db: PrismaClient,
  filters: { applicantId?: string; type?: string },
): Promise<ConflictOrderRow[]> {
  const rows = await db.order.findMany({
    where: {
      status: "CONFLICT",
      ...(filters.applicantId ? { applicantId: filters.applicantId } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      dueDate: true,
      quantity: true,
      applicantId: true,
      applicant: { select: { username: true, email: true } },
      lastModifiedById: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { conflictComments: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    dueDate: r.dueDate,
    quantity: r.quantity,
    applicantId: r.applicantId,
    applicantUsername: r.applicant.username,
    applicantEmail: r.applicant.email,
    lastModifiedById: r.lastModifiedById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    commentCount: r._count.conflictComments,
  }));
}

export async function findConflictOrderById(
  db: PrismaClient,
  id: string,
): Promise<ConflictOrderDetail | null> {
  const row = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      dueDate: true,
      quantity: true,
      applicantId: true,
      applicant: { select: { username: true, email: true } },
      lastModifiedById: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { conflictComments: true } },
      conflictComments: {
        select: commentSelect,
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    dueDate: row.dueDate,
    quantity: row.quantity,
    applicantId: row.applicantId,
    applicantUsername: row.applicant.username,
    applicantEmail: row.applicant.email,
    lastModifiedById: row.lastModifiedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    commentCount: row._count.conflictComments,
    comments: row.conflictComments.map((c) => ({
      id: c.id,
      orderId: c.orderId,
      authorId: c.authorId,
      authorUsername: c.author.username,
      authorRole: c.author.role,
      content: c.content,
      type: c.type,
      proposalData: c.proposalData,
      createdAt: c.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createConflictComment(
  db: PrismaClient,
  input: CreateCommentInput,
): Promise<ConflictCommentRow> {
  const c = await db.conflictComment.create({
    data: {
      orderId: input.orderId,
      authorId: input.authorId,
      content: input.content,
      type: input.type,
      proposalData:
        input.proposalData !== undefined
          ? (input.proposalData as object)
          : undefined,
    },
    select: commentSelect,
  });

  return {
    id: c.id,
    orderId: c.orderId,
    authorId: c.authorId,
    authorUsername: c.author.username,
    authorRole: c.author.role,
    content: c.content,
    type: c.type,
    proposalData: c.proposalData,
    createdAt: c.createdAt,
  };
}
