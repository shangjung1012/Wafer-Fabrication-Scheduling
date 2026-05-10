/**
 * modules/order/order-service.ts
 *
 * Business logic for Order management.
 * RBAC scope is resolved via modules/auth/scope.ts (resolveActorScope + getScopeGroup).
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
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
  const scope = await resolveActorScope(ctx, db);

  if (scope.role === "SALES") {
    return findOrders(db, { applicantId: scope.userId, status, keyword });
  }

  return findOrders(db, { group: getScopeGroup(scope), status, keyword });
}

export async function getOrder(
  ctx: RequestContext,
  db: PrismaClient,
  id: string
): Promise<OrderRow> {
  const scope = await resolveActorScope(ctx, db);

  const order = await findOrderById(db, id);
  if (!order) orderNotFound();

  if (scope.role === "SALES") {
    if (order.applicantId !== scope.userId) orderNotFound();
    return order;
  }

  if (order.type !== getScopeGroup(scope)) orderNotFound();
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
  const scope = await resolveActorScope(ctx, db);

  if (input.type !== getScopeGroup(scope)) {
    throw new ForbiddenError("You can only create orders for your own production type.");
  }

  return createOrder(db, {
    dueDate: input.dueDate,
    quantity: input.quantity,
    name: input.name,
    type: input.type,
    applicantId: scope.userId,
  });
}

export type UpdateOrderServiceInput = {
  status?: OrderStatus;
  dueDate?: Date;
  quantity?: number;
  name?: string;
};

export async function updateOrderService(
  ctx: RequestContext,
  db: PrismaClient,
  id: string,
  input: UpdateOrderServiceInput
): Promise<OrderRow> {
  requireRole(ctx, ["SALES", "ADMIN"]);
  const scope = await resolveActorScope(ctx, db);

  const order = await findOrderById(db, id);
  if (!order) orderNotFound();

  if (scope.role === "SALES") {
    if (input.status !== undefined) {
      throw new ForbiddenError("You cannot change order status directly.");
    }
    if (order.applicantId !== scope.userId) {
      throw new ForbiddenError("You can only edit your own orders.");
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ForbiddenError("You can only edit orders that are still pending.");
    }
    const salesInput: UpdateOrderInput = {
      dueDate: input.dueDate,
      quantity: input.quantity,
      name: input.name,
    };
    const result = await updateOrder(db, id, salesInput);
    if (!result) orderNotFound();
    return result;
  }

  // ADMIN: must be same production group
  if (order.type !== getScopeGroup(scope)) {
    throw new ForbiddenError("This order is not in your production group.");
  }

  const result = await updateOrder(db, id, { ...input, lastModifiedById: scope.userId });
  if (!result) orderNotFound();
  return result;
}

export async function deleteOrdersService(
  ctx: RequestContext,
  db: PrismaClient,
  ids: string[]
): Promise<{ count: number }> {
  requireRole(ctx, ["ADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  const group = getScopeGroup(scope);

  // Verify all orders belong to admin's group before deleting
  const orders = await Promise.all(ids.map((id) => findOrderById(db, id)));
  for (const order of orders) {
    if (!order || order.type !== group) {
      throw new ForbiddenError("One or more orders are not in your production group.");
    }
  }

  return deleteOrders(db, ids);
}
