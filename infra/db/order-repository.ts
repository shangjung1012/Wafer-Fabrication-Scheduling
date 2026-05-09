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
  productionDate: Date | null;
  quantity: number;
  applicantId: string;
  name: string;
  type: string;
  factoryId: string | null;
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
  factoryId?: string | null;
};

export type UpdateOrderInput = {
  status?: OrderStatus;
  dueDate?: Date;
  productionDate?: Date | null;
  quantity?: number;
  name?: string;
  type?: string;
  factoryId?: string | null;
  lastModifiedById?: string | null;
};

export type OrderFilters = {
  applicantId?: string;
  factoryId?: string;
  status?: OrderStatus;
  keyword?: string;
  group?: string;
  permittedOrderIds?: string[];
};

// ---------------------------------------------------------------------------
// Select shape (reused across queries)
// ---------------------------------------------------------------------------

const orderSelect = {
  id: true,
  status: true,
  dueDate: true,
  productionDate: true,
  quantity: true,
  applicantId: true,
  name: true,
  type: true,
  factoryId: true,
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
  const { applicantId, factoryId, status, keyword, group, permittedOrderIds } =
    filters;

  // Build the ownership / permission clause
  let ownershipClause: object | undefined;
  if (applicantId && permittedOrderIds && permittedOrderIds.length > 0) {
    ownershipClause = {
      OR: [{ applicantId }, { id: { in: permittedOrderIds } }],
    };
  } else if (applicantId) {
    ownershipClause = { applicantId };
  } else if (permittedOrderIds && permittedOrderIds.length > 0) {
    ownershipClause = { id: { in: permittedOrderIds } };
  }

  // Build keyword search clause (name OR type)
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
      ...(factoryId ? { factoryId } : {}),
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

export async function findPermittedOrderIds(
  db: PrismaClient,
  userId: string
): Promise<string[]> {
  const permissions = await db.orderPermission.findMany({
    where: { userId },
    select: { orderId: true },
  });
  return permissions.map((p) => p.orderId);
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
      factoryId: input.factoryId ?? null,
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
      ...(input.productionDate !== undefined
        ? { productionDate: input.productionDate }
        : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.factoryId !== undefined ? { factoryId: input.factoryId } : {}),
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
