/**
 * infra/db/order-repository.ts
 *
 * All DB access for the Order model.
 * Business logic (RBAC, state machine, scope filtering) belongs in modules/order/.
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import { OrderStatus } from "@/lib/generated/prisma";

export { OrderStatus };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrderRow = {
  id: string;
  status: OrderStatus;
  dueDate: Date;
  quantity: number;
  applicantId: string;
  name: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  lastModifiedById: string | null;
};

export type CreateOrderInput = {
  dueDate: Date;
  quantity: number;
  name: string;
  type: string;
  applicantId: string;
};

export type UpdateOrderInput = {
  status?: OrderStatus;
  dueDate?: Date;
  quantity?: number;
  name?: string;
  type?: string;
  lastModifiedById?: string | null;
};

export type OrderFilters = {
  applicantId?: string;
  status?: OrderStatus;
  keyword?: string;
  group?: string;
};

// ---------------------------------------------------------------------------
// Select shape (reused across queries)
// ---------------------------------------------------------------------------

const orderSelect = {
  id: true,
  status: true,
  dueDate: true,
  quantity: true,
  applicantId: true,
  name: true,
  type: true,
  createdAt: true,
  updatedAt: true,
  lastModifiedById: true,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findOrders(
  db: PrismaClient,
  filters: OrderFilters = {}
): Promise<OrderRow[]> {
  const { applicantId, status, keyword, group } = filters;

  const ownershipClause = applicantId ? { applicantId } : undefined;

  const keywordClause =
    keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" as const } },
            { type: { contains: keyword, mode: "insensitive" as const } },
          ],
        }
      : undefined;

  return db.order.findMany({
    where: {
      ...(ownershipClause ?? {}),
      ...(status ? { status } : {}),
      ...(group ? { type: group } : {}),
      ...(keywordClause ?? {}),
    },
    select: orderSelect,
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function findOrderById(
  db: PrismaClient,
  id: string
): Promise<OrderRow | null> {
  return db.order.findUnique({
    where: { id },
    select: orderSelect,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function createOrder(
  db: PrismaClient,
  input: CreateOrderInput
): Promise<OrderRow> {
  return db.order.create({
    data: {
      dueDate: input.dueDate,
      quantity: input.quantity,
      name: input.name,
      type: input.type,
      applicantId: input.applicantId,
    },
    select: orderSelect,
  });
}

export async function updateOrder(
  db: PrismaClient,
  id: string,
  input: UpdateOrderInput
): Promise<OrderRow | null> {
  const exists = await db.order.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  return db.order.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.lastModifiedById !== undefined
        ? { lastModifiedById: input.lastModifiedById }
        : {}),
    },
    select: orderSelect,
  });
}

export async function deleteOrders(
  db: PrismaClient,
  ids: string[]
): Promise<{ count: number }> {
  const result = await db.order.updateMany({
    where: { id: { in: ids } },
    data: { status: OrderStatus.CANCELLED },
  });
  return { count: result.count };
}

export async function bulkUpdateOrderStatus(
  db: PrismaClient,
  updates: { id: string; status: OrderStatus }[]
): Promise<void> {
  for (const { id, status } of updates) {
    await db.order.update({ where: { id }, data: { status } });
  }
}

// ---------------------------------------------------------------------------
// Schedule engine queries
// ---------------------------------------------------------------------------

export async function findOrdersForScheduling(
  db: PrismaClient,
  type: string,
) {
  return db.order.findMany({
    where: {
      type,
      status: {
        in: [
          OrderStatus.APPROVED,
          OrderStatus.SCHEDULED,
          OrderStatus.IN_PRODUCTION,
        ],
      },
    },
    include: {
      assignments: true,
    },
  });
}
