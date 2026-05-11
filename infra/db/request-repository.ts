/**
 * infra/db/request-repository.ts
 *
 * All DB access for the OrderRequest model.
 * Business logic (RBAC, scope filtering) belongs in modules/order/.
 */

import type { PrismaClient } from "@/lib/generated/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RequestRow = {
  id: string;
  applicantId: string;
  orderId: string;
  message: string;
  payload: unknown; // Prisma returns JsonValue
};

export type CreateRequestInput = {
  applicantId: string;
  orderId: string;
  message: string;
  payload?: unknown;
};

export type UpdateRequestInput = {
  message?: string;
  payload?: unknown;
};

export type RequestFilters = {
  applicantId?: string; // Sales sees their own
  orderIds?: string[]; // Admin sees requests for orders in their factory
};

// ---------------------------------------------------------------------------
// Select shape (reused across queries)
// ---------------------------------------------------------------------------

const requestSelect = {
  id: true,
  applicantId: true,
  orderId: true,
  message: true,
  payload: true,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findRequests(
  db: PrismaClient,
  filters: RequestFilters = {},
): Promise<RequestRow[]> {
  const { applicantId, orderIds } = filters;

  // Build the ownership clause
  let ownershipClause: object | undefined;
  if (applicantId && orderIds && orderIds.length > 0) {
    ownershipClause = {
      OR: [{ applicantId }, { orderId: { in: orderIds } }],
    };
  } else if (applicantId) {
    ownershipClause = { applicantId };
  } else if (orderIds && orderIds.length > 0) {
    ownershipClause = { orderId: { in: orderIds } };
  }

  return db.orderRequest.findMany({
    where: {
      ...(ownershipClause ?? {}),
    },
    select: requestSelect,
    orderBy: [{ id: "asc" }],
  });
}

export async function findRequestById(
  db: PrismaClient,
  id: string,
): Promise<RequestRow | null> {
  return db.orderRequest.findUnique({
    where: { id },
    select: requestSelect,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createRequest(
  db: PrismaClient,
  input: CreateRequestInput,
): Promise<RequestRow> {
  return db.orderRequest.create({
    data: {
      applicantId: input.applicantId,
      orderId: input.orderId,
      message: input.message,
      payload:
        input.payload !== undefined ? (input.payload as object) : undefined,
    },
    select: requestSelect,
  });
}

export async function updateRequest(
  db: PrismaClient,
  id: string,
  input: UpdateRequestInput,
): Promise<RequestRow | null> {
  const exists = await db.orderRequest.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return null;

  return db.orderRequest.update({
    where: { id },
    data: {
      ...(input.message !== undefined ? { message: input.message } : {}),
      ...(input.payload !== undefined
        ? { payload: input.payload as object }
        : {}),
    },
    select: requestSelect,
  });
}
