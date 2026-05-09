/**
 * modules/order/order-service.ts
 *
 * Business logic for Order management.
 * Role-scoped: SALES sees own + permitted orders, ADMIN sees factory orders,
 * SUPERADMIN sees all orders within their production type (group).
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
import {
  findOrders,
  findOrderById,
  findPermittedOrderIds,
  createOrder,
  updateOrder,
  deleteOrders,
  type OrderRow,
  type CreateOrderInput,
  type UpdateOrderInput,
  OrderStatus,
} from "@/infra/db/order-repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the factory row for the authenticated ADMIN.
 * Throws ForbiddenError if the caller has no factory assigned.
 */
async function getAdminFactory(
  ctx: RequestContext,
  db: PrismaClient
): Promise<{ id: string }> {
  const factory = await db.factory.findFirst({
    where: { adminId: ctx.user.id },
    select: { id: true },
  });
  if (!factory) {
    throw new ForbiddenError("Your account is not assigned to any factory.");
  }
  return factory;
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
  factoryId?: string;
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
    const permittedOrderIds = await findPermittedOrderIds(db, ctx.user.id);
    return findOrders(db, {
      applicantId: ctx.user.id,
      permittedOrderIds,
      status,
      keyword,
    });
  }

  if (ctx.user.role === "ADMIN") {
    requireRole(ctx, ["ADMIN"]);
    const factory = await getAdminFactory(ctx, db);
    return findOrders(db, {
      factoryId: factory.id,
      status,
      keyword,
    });
  }

  // SUPERADMIN
  requireRole(ctx, ["SUPERADMIN"]);
  const me = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { group: true },
  });
  if (!me?.group) {
    throw new ForbiddenError(
      "Your account does not have a production type (group) assigned."
    );
  }
  return findOrders(db, {
    group: me.group,
    factoryId: input.factoryId,
    status,
    keyword,
  });
}

export async function getOrder(
  ctx: RequestContext,
  db: PrismaClient,
  id: string
): Promise<OrderRow> {
  const order = await findOrderById(db, id);
  if (!order) orderNotFound();

  if (ctx.user.role === "SALES") {
    // Must be applicant OR have an OrderPermission entry
    const permittedIds = await findPermittedOrderIds(db, ctx.user.id);
    const permitted =
      order.applicantId === ctx.user.id || permittedIds.includes(order.id);
    if (!permitted) orderNotFound();
    return order;
  }

  if (ctx.user.role === "ADMIN") {
    const factory = await getAdminFactory(ctx, db);
    if (order.factoryId !== factory.id) orderNotFound();
    return order;
  }

  // SUPERADMIN: order's type must match caller's group
  const me = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { group: true },
  });
  if (!me?.group || order.type !== me.group) orderNotFound();
  return order;
}

export type CreateOrderServiceInput = {
  dueDate: Date;
  quantity: number;
  name: string;
  type: string;
  factoryId?: string | null;
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
    factoryId: input.factoryId ?? null,
  } satisfies CreateOrderInput);
}

export type UpdateOrderServiceInput = {
  status?: OrderStatus;
  dueDate?: Date;
  productionDate?: Date | null;
  quantity?: number;
  name?: string;
  type?: string;
  factoryId?: string | null;
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
    if (order.applicantId !== ctx.user.id) {
      throw new ForbiddenError("You can only edit your own orders.");
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ForbiddenError(
        "You can only edit orders that are still pending."
      );
    }
    // SALES may only change: dueDate, quantity, name, type
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

  // ADMIN path
  const factory = await getAdminFactory(ctx, db);
  if (order.factoryId !== factory.id) {
    throw new ForbiddenError(
      "This order does not belong to your factory."
    );
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
