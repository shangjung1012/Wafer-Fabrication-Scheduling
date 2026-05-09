/**
 * modules/order/request-service.ts
 *
 * Business logic for OrderRequest management.
 * Role-scoped: SALES sees own requests, ADMIN sees requests for their factory's orders.
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError } from "@/modules/auth/rbac";
import {
  findRequests,
  findRequestById,
  createRequest,
  updateRequest,
  type RequestRow,
  type CreateRequestInput,
  type UpdateRequestInput,
} from "@/infra/db/request-repository";
import { findOrderById, updateOrder, OrderStatus } from "@/infra/db/order-repository";

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

/** Canonical 404 for requests. */
function requestNotFound(): never {
  throw Object.assign(new Error("Request not found."), {
    status: 404,
    code: "NOT_FOUND",
  });
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export async function listRequests(
  ctx: RequestContext,
  db: PrismaClient,
  _input: Record<string, never> = {}
): Promise<RequestRow[]> {
  if (ctx.user.role === "SALES") {
    return findRequests(db, { applicantId: ctx.user.id });
  }

  // ADMIN
  requireRole(ctx, ["ADMIN"]);
  const factory = await getAdminFactory(ctx, db);
  const orders = await db.order.findMany({
    where: { factoryId: factory.id },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  return findRequests(db, { orderIds });
}

export async function getRequest(
  ctx: RequestContext,
  db: PrismaClient,
  id: string
): Promise<RequestRow> {
  const request = await findRequestById(db, id);
  if (!request) requestNotFound();

  if (ctx.user.role === "SALES") {
    if (request.applicantId !== ctx.user.id) requestNotFound();
    return request;
  }

  // ADMIN: verify order belongs to admin's factory
  requireRole(ctx, ["ADMIN"]);
  const factory = await getAdminFactory(ctx, db);
  const order = await findOrderById(db, request.orderId);
  if (!order || order.factoryId !== factory.id) requestNotFound();
  return request;
}

export type CreateRequestServiceInput = {
  orderId: string;
  message: string;
  payload?: unknown;
};

export async function createRequestService(
  ctx: RequestContext,
  db: PrismaClient,
  input: CreateRequestServiceInput
): Promise<RequestRow> {
  requireRole(ctx, ["SALES"]);

  // Verify linked order exists
  const order = await findOrderById(db, input.orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found."), {
      status: 404,
      code: "NOT_FOUND",
    });
  }

  // Verify caller owns the order or has an OrderPermission entry
  const ownsOrder = order.applicantId === ctx.user.id;
  if (!ownsOrder) {
    const permission = await db.orderPermission.findFirst({
      where: { userId: ctx.user.id, orderId: input.orderId },
    });
    if (!permission) {
      throw new ForbiddenError(
        "You do not have permission to submit a request for this order."
      );
    }
  }

  return createRequest(db, {
    orderId: input.orderId,
    message: input.message,
    payload: input.payload,
    applicantId: ctx.user.id,
  } satisfies CreateRequestInput);
}

export type UpdateRequestServiceInput = {
  message?: string;
  payload?: unknown;
};

export async function updateRequestService(
  ctx: RequestContext,
  db: PrismaClient,
  id: string,
  input: UpdateRequestServiceInput
): Promise<RequestRow> {
  requireRole(ctx, ["SALES"]);

  const request = await findRequestById(db, id);
  if (!request) requestNotFound();

  if (request.applicantId !== ctx.user.id) {
    throw new ForbiddenError("You can only edit your own requests.");
  }

  const result = await updateRequest(db, id, input satisfies UpdateRequestInput);
  if (!result) requestNotFound();
  return result;
}

export async function approveRequest(
  ctx: RequestContext,
  db: PrismaClient,
  id: string
): Promise<{ requestId: string; orderId: string }> {
  requireRole(ctx, ["ADMIN"]);

  const request = await findRequestById(db, id);
  if (!request) requestNotFound();

  // Verify the linked order is in admin's factory (or unassigned)
  const factory = await getAdminFactory(ctx, db);
  const order = await findOrderById(db, request.orderId);
  if (!order) {
    throw Object.assign(new Error("Order not found."), {
      status: 404,
      code: "NOT_FOUND",
    });
  }
  if (order.factoryId !== null && order.factoryId !== factory.id) {
    throw new ForbiddenError(
      "This request's order does not belong to your factory."
    );
  }

  // Apply safe fields from request payload to the order
  const payload = (request.payload ?? {}) as Record<string, unknown>;
  const safeFields: Record<string, unknown> = {};

  for (const key of ["dueDate", "quantity", "name", "type", "factoryId"] as const) {
    if (key in payload) {
      safeFields[key] = payload[key];
    }
  }

  if ("status" in payload) {
    const candidateStatus = payload["status"];
    if (
      typeof candidateStatus === "string" &&
      Object.values(OrderStatus).includes(candidateStatus as OrderStatus)
    ) {
      safeFields["status"] = candidateStatus as OrderStatus;
    }
  }

  await updateOrder(db, request.orderId, {
    ...safeFields,
    lastModifiedById: ctx.user.id,
  });

  return { requestId: id, orderId: request.orderId };
}
