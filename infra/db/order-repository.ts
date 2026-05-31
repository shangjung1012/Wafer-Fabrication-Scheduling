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
  isFixed: boolean;
  isPrioritized: boolean;
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
  isFixed?: boolean;
  isPrioritized?: boolean;
};

export type UpdateOrderInput = {
  status?: OrderStatus;
  dueDate?: Date;
  quantity?: number;
  name?: string;
  type?: string;
  isFixed?: boolean;
  isPrioritized?: boolean;
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
  isFixed: true,
  isPrioritized: true,
  createdAt: true,
  updatedAt: true,
  lastModifiedById: true,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findOrders(
  db: PrismaClient,
  filters: OrderFilters = {},
): Promise<OrderRow[]> {
  const { applicantId, status, keyword, group } = filters;

  const ownershipClause = applicantId ? { applicantId } : undefined;

  const keywordClause = keyword
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
  id: string,
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
  input: CreateOrderInput,
): Promise<OrderRow> {
  return db.order.create({
    data: {
      dueDate: input.dueDate,
      quantity: input.quantity,
      name: input.name,
      type: input.type,
      applicantId: input.applicantId,
      ...(input.isFixed !== undefined ? { isFixed: input.isFixed } : {}),
      ...(input.isPrioritized !== undefined
        ? { isPrioritized: input.isPrioritized }
        : {}),
    },
    select: orderSelect,
  });
}

export async function updateOrder(
  db: PrismaClient,
  id: string,
  input: UpdateOrderInput,
): Promise<OrderRow | null> {
  const exists = await db.order.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return null;

  return db.order.update({
    where: { id },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.isFixed !== undefined ? { isFixed: input.isFixed } : {}),
      ...(input.isPrioritized !== undefined
        ? { isPrioritized: input.isPrioritized }
        : {}),
      ...(input.lastModifiedById !== undefined
        ? { lastModifiedById: input.lastModifiedById }
        : {}),
    },
    select: orderSelect,
  });
}

export async function deleteOrders(
  db: PrismaClient,
  ids: string[],
): Promise<{ count: number }> {
  const result = await db.order.updateMany({
    where: { id: { in: ids } },
    data: { status: OrderStatus.CANCELLED },
  });

  return { count: result.count };
}

export async function bulkUpdateOrderStatus(
  db: PrismaClient,
  updates: { id: string; status: OrderStatus }[],
): Promise<void> {
  for (const { id, status } of updates) {
    await db.order.update({ where: { id }, data: { status } });
  }
}

export async function applyScheduleOrdersUpdate(
  db: PrismaClient,
  scheduledIds: string[],
  failedIds: string[],
  operatorId: string,
): Promise<void> {
  if (scheduledIds.length > 0) {
    await db.order.updateMany({
      where: {
        id: { in: scheduledIds },
        status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
      },
      data: { status: OrderStatus.SCHEDULED, lastModifiedById: operatorId },
    });
  }

  if (failedIds.length > 0) {
    await db.order.updateMany({
      where: {
        id: { in: failedIds },
        status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
      },
      data: { status: OrderStatus.FAILED, lastModifiedById: operatorId },
    });
  }
}

export async function findPendingOrderTypes(
  db: PrismaClient,
): Promise<string[]> {
  const orders = await db.order.findMany({
    where: { status: OrderStatus.PENDING },
    select: { type: true },
    distinct: ["type"],
  });
  return orders.map((o) => o.type);
}

// ---------------------------------------------------------------------------
// Schedule engine queries
// ---------------------------------------------------------------------------

export async function findOrdersForScheduling(
  db: PrismaClient,
  type: string,
  targetOrderIds?: string[],
  fetchAllPending: boolean = false,
) {
  return db.order.findMany({
    where: {
      type,
      OR: [
        {
          status: {
            in: [OrderStatus.SCHEDULED, OrderStatus.IN_PRODUCTION],
          },
        },
        {
          status: OrderStatus.PENDING,
          ...(fetchAllPending ? {} : { id: { in: targetOrderIds || [] } }),
        },
      ],
    },
    include: {
      assignments: true,
      applicant: { select: { email: true, username: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// ConflictIssue creation helpers
// ---------------------------------------------------------------------------

/**
 * Fetch an order with the fields required to build a ConflictIssue
 * contextSnapshot + send the issue-created email.
 *
 * Includes:
 *  - applicant (email/username) for assignee fallback + email recipient
 *  - the factories of this order's productionType (and their admin emails)
 *    so the caller can pick an admin assignee fallback and email recipients
 */
export async function findOrderForIssueCreation(db: PrismaClient, id: string) {
  return db.order.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      type: true,
      quantity: true,
      dueDate: true,
      status: true,
      updatedAt: true,
      applicantId: true,
      applicant: { select: { id: true, email: true, username: true } },
    },
  });
}

/**
 * Find all SCHEDULED OrderAssignments that overlap [windowStart, windowEnd]
 * in any of the given factories, excluding `excludeOrderId`. Returns the
 * deduped list of (orderId, name, isPrioritized, isFixed) — used to populate
 * `competingOrders` in the ConflictIssue contextSnapshot.
 */
export async function findCompetingScheduledOrders(
  db: PrismaClient,
  args: {
    factoryIds: string[];
    windowStart: Date;
    windowEnd: Date;
    excludeOrderId: string;
  },
): Promise<
  Array<{ id: string; name: string; isPrioritized: boolean; isFixed: boolean }>
> {
  if (args.factoryIds.length === 0) return [];

  const assignments = await db.orderAssignment.findMany({
    where: {
      factoryId: { in: args.factoryIds },
      status: "SCHEDULED",
      productionDate: { gte: args.windowStart, lte: args.windowEnd },
      orderId: { not: args.excludeOrderId },
    },
    select: {
      order: {
        select: {
          id: true,
          name: true,
          isPrioritized: true,
          isFixed: true,
        },
      },
    },
  });

  const seen = new Map<
    string,
    { id: string; name: string; isPrioritized: boolean; isFixed: boolean }
  >();
  for (const a of assignments) {
    if (!seen.has(a.order.id)) {
      seen.set(a.order.id, {
        id: a.order.id,
        name: a.order.name,
        isPrioritized: a.order.isPrioritized,
        isFixed: a.order.isFixed,
      });
    }
  }
  return Array.from(seen.values());
}

/**
 * Batch version: fetches multiple orders for issue creation in a single query.
 * Returns a Map<orderId, orderData>.
 */
export async function findOrdersForIssueCreationBatch(
  db: PrismaClient,
  ids: string[],
): Promise<
  Map<
    string,
    NonNullable<Awaited<ReturnType<typeof findOrderForIssueCreation>>>
  >
> {
  if (ids.length === 0) return new Map();
  const orders = await db.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      type: true,
      quantity: true,
      dueDate: true,
      status: true,
      updatedAt: true,
      applicantId: true,
      applicant: { select: { id: true, email: true, username: true } },
    },
  });
  return new Map(orders.map((o) => [o.id, o as NonNullable<typeof o>]));
}

/**
 * Batch version: fetch all SCHEDULED OrderAssignments across factoryIds
 * and a date range, excluding the given orderIds. Returns raw assignment
 * rows so the caller can filter per-order window in memory.
 */
export async function findCompetingScheduledOrdersBatch(
  db: PrismaClient,
  args: {
    factoryIds: string[];
    windowStart: Date;
    windowEnd: Date;
    excludeOrderIds: string[];
  },
): Promise<
  Array<{
    productionDate: Date;
    factoryId: string;
    order: {
      id: string;
      name: string;
      isPrioritized: boolean;
      isFixed: boolean;
    };
  }>
> {
  if (args.factoryIds.length === 0) return [];
  return db.orderAssignment.findMany({
    where: {
      factoryId: { in: args.factoryIds },
      status: "SCHEDULED",
      productionDate: { gte: args.windowStart, lte: args.windowEnd },
      orderId: { notIn: args.excludeOrderIds },
    },
    select: {
      productionDate: true,
      factoryId: true,
      order: {
        select: { id: true, name: true, isPrioritized: true, isFixed: true },
      },
    },
  });
}

export async function bulkUpdateOrderModifiedBy(
  db: PrismaClient,
  orderIds: string[],
  lastModifiedById: string,
): Promise<void> {
  if (orderIds.length === 0) return;
  await db.order.updateMany({
    where: { id: { in: orderIds } },
    data: { lastModifiedById },
  });
}

export async function bulkUpdateOrderStatusAndModifiedBy(
  db: PrismaClient,
  orderIds: string[],
  status: OrderStatus,
  lastModifiedById: string,
): Promise<void> {
  if (orderIds.length === 0) return;
  await db.order.updateMany({
    where: { id: { in: orderIds } },
    data: { status, lastModifiedById },
  });
}
