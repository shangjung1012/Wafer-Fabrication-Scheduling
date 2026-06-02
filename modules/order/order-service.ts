/**
 * modules/order/order-service.ts
 *
 * Business logic for Order management.
 * RBAC scope is resolved via modules/auth/scope.ts (resolveActorScope + getScopeGroup).
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import { AssignmentStatus } from "@/lib/generated/prisma";
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
import { upsertDailyCapacityDelta } from "@/infra/db/capacity-repository";
import { findFactoriesMaxCapacity } from "@/infra/db/factory-repository";
import {
  withScheduleLock,
  incrementScheduleVersion,
  getScheduleVersion,
} from "@/infra/redis/schedule-store";
import {
  validateOrderQuantity,
  validateOrderType,
} from "@/modules/order/order-validation";
import { assertOrderStatusTransition } from "@/modules/order/order-status";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orderNotFound(): never {
  throw Object.assign(new Error("Order not found."), {
    status: 404,
    code: "NOT_FOUND",
  });
}

function affectsSchedule(input: UpdateOrderInput): boolean {
  return (
    input.status !== undefined ||
    input.dueDate !== undefined ||
    input.quantity !== undefined ||
    input.isFixed !== undefined ||
    input.isPrioritized !== undefined
  );
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
  input: ListOrdersInput = {},
): Promise<OrderRow[]> {
  const { status, keyword } = input;
  const scope = await resolveActorScope(ctx, db);

  if (scope.role === "SALES") {
    return findOrders(db, { applicantId: scope.userId, status, keyword });
  }

  if (scope.role === "SUPERADMIN") {
    const rows = await findOrders(db, { status, keyword });
    return rows.filter((o) => ["A", "B", "C"].includes(o.type));
  }

  return findOrders(db, { group: getScopeGroup(scope), status, keyword });
}

export async function getOrder(
  ctx: RequestContext,
  db: PrismaClient,
  id: string,
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
  input: CreateOrderServiceInput,
): Promise<OrderRow> {
  requireRole(ctx, ["SALES", "ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  validateOrderQuantity(input.quantity);
  const type = validateOrderType(input.type);

  if (scope.role === "ADMIN" && getScopeGroup(scope) !== type) {
    throw new ForbiddenError(
      "You can only create orders in your production group.",
    );
  }

  const order = await createOrder(db, {
    dueDate: input.dueDate,
    quantity: input.quantity,
    name: input.name,
    type,
    applicantId: scope.userId,
  });
  await incrementScheduleVersion(order.type);
  return order;
}

export type UpdateOrderServiceInput = {
  status?: OrderStatus;
  dueDate?: Date;
  quantity?: number;
  name?: string;
  isFixed?: boolean;
  isPrioritized?: boolean;
  expectedScheduleVersion?: number;
};

export async function updateOrderService(
  ctx: RequestContext,
  db: PrismaClient,
  id: string,
  input: UpdateOrderServiceInput,
): Promise<OrderRow> {
  requireRole(ctx, ["SALES", "ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);

  const order = await findOrderById(db, id);
  if (!order) orderNotFound();

  if (scope.role === "SALES") {
    if (input.isFixed !== undefined || input.isPrioritized !== undefined) {
      throw new ForbiddenError(
        "You cannot change order scheduling lock or priority flags.",
      );
    }
    if (input.status !== undefined) {
      throw new ForbiddenError("You cannot change order status directly.");
    }
    if (order.applicantId !== scope.userId) {
      throw new ForbiddenError("You can only edit your own orders.");
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ForbiddenError(
        "You can only edit orders that are still pending.",
      );
    }
    const salesInput: UpdateOrderInput = {
      dueDate: input.dueDate,
      quantity: input.quantity,
      name: input.name,
      lastModifiedById: scope.userId,
    };
    if (salesInput.quantity !== undefined) {
      validateOrderQuantity(salesInput.quantity);
    }
    if (affectsSchedule(salesInput)) {
      return withScheduleLock(order.type, async () => {
        if (input.expectedScheduleVersion !== undefined) {
          const current = await getScheduleVersion(order.type);
          if (current !== input.expectedScheduleVersion) {
            throw new Error(
              `environment has changed: schedule was modified for type ${order.type}, please reload`,
            );
          }
        }
        const result = await updateOrder(db, id, salesInput);
        if (!result) orderNotFound();
        await incrementScheduleVersion(order.type);
        return result;
      });
    }
    const result = await updateOrder(db, id, salesInput);
    if (!result) orderNotFound();
    return result;
  }

  // ADMIN / SUPERADMIN: must be same production group
  if (order.type !== getScopeGroup(scope)) {
    throw new ForbiddenError("This order is not in your production group.");
  }

  if (input.quantity !== undefined) validateOrderQuantity(input.quantity);
  if (input.status !== undefined) {
    assertOrderStatusTransition(order.status, input.status);
  }

  if (input.status === OrderStatus.CANCELLED) {
    return withScheduleLock(order.type, async () => {
      if (input.expectedScheduleVersion !== undefined) {
        const current = await getScheduleVersion(order.type);
        if (current !== input.expectedScheduleVersion) {
          throw new Error(
            `environment has changed: schedule was modified for type ${order.type}, please reload`,
          );
        }
      }
      const result = await cancelOrdersAndReleaseCapacity(db, [id]);
      if (result.count === 0) orderNotFound();
      const cancelledOrder = await findOrderById(db, id);
      if (!cancelledOrder) orderNotFound();
      await incrementScheduleVersion(order.type);
      return cancelledOrder;
    });
  }

  const adminInput: UpdateOrderInput = {
    ...input,
    lastModifiedById: scope.userId,
  };
  if (affectsSchedule(adminInput)) {
    return withScheduleLock(order.type, async () => {
      if (input.expectedScheduleVersion !== undefined) {
        const current = await getScheduleVersion(order.type);
        if (current !== input.expectedScheduleVersion) {
          throw new Error(
            `environment has changed: schedule was modified for type ${order.type}, please reload`,
          );
        }
      }
      const result = await updateOrder(db, id, adminInput);
      if (!result) orderNotFound();
      await incrementScheduleVersion(order.type);
      return result;
    });
  }
  const result = await updateOrder(db, id, adminInput);
  if (!result) orderNotFound();
  return result;
}

export async function deleteOrdersService(
  ctx: RequestContext,
  db: PrismaClient,
  ids: string[],
): Promise<{ count: number }> {
  requireRole(ctx, ["ADMIN"]);
  const scope = await resolveActorScope(ctx, db);
  const group = getScopeGroup(scope);

  // Verify all orders belong to admin's group before deleting
  const orders = await Promise.all(ids.map((id) => findOrderById(db, id)));
  for (const order of orders) {
    if (!order || order.type !== group) {
      throw new ForbiddenError(
        "One or more orders are not in your production group.",
      );
    }
  }

  const types = Array.from(new Set(orders.map((o) => o!.type)));
  return withScheduleLock(types, async () => {
    const result = await cancelOrdersAndReleaseCapacity(db, ids);
    for (const type of types) {
      await incrementScheduleVersion(type);
    }
    return result;
  });
}

export async function cancelOrdersAndReleaseCapacity(
  db: PrismaClient,
  ids: string[],
): Promise<{ count: number }> {
  return db.$transaction(async (tx) => {
    const scheduledAssignments = await tx.orderAssignment.findMany({
      where: {
        orderId: { in: ids },
        status: AssignmentStatus.SCHEDULED,
      },
      select: {
        id: true,
        factoryId: true,
        productionDate: true,
        assignedQuantity: true,
      },
    });

    if (scheduledAssignments.length > 0) {
      const factories = await findFactoriesMaxCapacity(tx as PrismaClient);
      const factoryMaxById = new Map(
        factories.map((f) => [f.id, f.maxCapacity]),
      );

      for (const assignment of scheduledAssignments) {
        await upsertDailyCapacityDelta(
          tx as PrismaClient,
          assignment.factoryId,
          assignment.productionDate,
          assignment.assignedQuantity,
          factoryMaxById.get(assignment.factoryId) ?? 0,
        );
      }

      await tx.orderAssignment.updateMany({
        where: { id: { in: scheduledAssignments.map((a) => a.id) } },
        data: { status: AssignmentStatus.CANCELLED },
      });
    }

    return deleteOrders(tx as PrismaClient, ids);
  });
}
