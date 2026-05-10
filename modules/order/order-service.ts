/**
 * modules/order/order-service.ts
 *
 * Business logic for Order management.
 * Role-scoped: SALES sees own + permitted orders, ADMIN/SUPERADMIN see all
 * orders within their production type (group).
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
import {
  findOrders,
  findOrderById,
  createOrder,
  updateOrder,
  deleteOrders,
  type OrderRow,
  type UpdateOrderInput,
  OrderStatus,
} from "@/infra/db/order-repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves the production group for ADMIN or SUPERADMIN callers. */
async function getCallerGroup(
  ctx: RequestContext,
  db: PrismaClient
): Promise<string> {
  const me = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { group: true },
  });
  if (!me?.group) {
    throw new ForbiddenError(
      "Your account does not have a production type (group) assigned."
    );
  }
  return me.group;
}

/** Canonical 404 for orders. */
function orderNotFound(): never {
  throw Object.assign(new Error("Order not found."), {
    status: 404,
    code: "NOT_FOUND",
  });
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export type ListOrdersInput = {
  status?: OrderStatus;
  keyword?: string;
};

export async function listOrders(
  ctx: RequestContext,
  db: PrismaClient,
  input: ListOrdersInput = {}
): Promise<OrderRow[]> {
  const { status, keyword } = input;

  if (ctx.user.role === "SALES") {
    requireRole(ctx, ["SALES"]);
    return findOrders(db, { applicantId: ctx.user.id, status, keyword });
  }

  // ADMIN and SUPERADMIN: scope by production type group
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const group = await getCallerGroup(ctx, db);
  return findOrders(db, { group, status, keyword });
}

export async function getOrder(
  ctx: RequestContext,
  db: PrismaClient,
  id: string
): Promise<OrderRow> {
  const order = await findOrderById(db, id);
  if (!order) orderNotFound();

  if (ctx.user.role === "SALES") {
    if (order.applicantId !== ctx.user.id) orderNotFound();
    return order;
  }

  // ADMIN / SUPERADMIN: order's type must match caller's group
  const group = await getCallerGroup(ctx, db);
  if (order.type !== group) orderNotFound();
  return order;
}

export type CreateOrderServiceInput = {
  dueDate: Date;
  quantity: number;
  name: string;
  type: string;
};

export async function createOrderService(
  ctx: RequestContext,
  db: PrismaClient,
  input: CreateOrderServiceInput
): Promise<OrderRow> {
  requireRole(ctx, ["SALES"]);

  return createOrder(db, {
    dueDate: input.dueDate,
    quantity: input.quantity,
    name: input.name,
    type: input.type,
    applicantId: ctx.user.id,
  });
}

export type UpdateOrderServiceInput = {
  status?: OrderStatus;
  dueDate?: Date;
  quantity?: number;
  name?: string;
  type?: string;
};

export async function updateOrderService(
  ctx: RequestContext,
  db: PrismaClient,
  id: string,
  input: UpdateOrderServiceInput
): Promise<OrderRow> {
  requireRole(ctx, ["SALES", "ADMIN"]);

  const order = await findOrderById(db, id);
  if (!order) orderNotFound();

  if (ctx.user.role === "SALES") {
    if (input.status !== undefined) {
      throw new ForbiddenError("You cannot change order status directly.");
    }
    if (order.applicantId !== ctx.user.id) {
      throw new ForbiddenError("You can only edit your own orders.");
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ForbiddenError(
        "You can only edit orders that are still pending."
      );
    }
    const salesInput: UpdateOrderInput = {
      dueDate: input.dueDate,
      quantity: input.quantity,
      name: input.name,
      type: input.type,
    };
    const result = await updateOrder(db, id, salesInput);
    if (!result) orderNotFound();
    return result;
  }

  // ADMIN path: must be in same production group
  const group = await getCallerGroup(ctx, db);
  if (order.type !== group) {
    throw new ForbiddenError("This order is not in your production group.");
  }

  const adminInput: UpdateOrderInput = {
    ...input,
    lastModifiedById: ctx.user.id,
  };
  const result = await updateOrder(db, id, adminInput);
  if (!result) orderNotFound();
  return result;
}

export async function deleteOrdersService(
  ctx: RequestContext,
  db: PrismaClient,
  ids: string[]
): Promise<{ count: number }> {
  requireRole(ctx, ["ADMIN"]);
  return deleteOrders(db, ids);
}
