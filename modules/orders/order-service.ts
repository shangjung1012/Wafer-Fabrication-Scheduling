/**
 * modules/orders/order-service.ts
 *
 * RBAC scope check for Order resources.
 * Business logic (listOrders, getOrder, createOrder, etc.) is implemented by
 * the schedule team — add permissions on top using assertOrderAccess below.
 *
 * Usage pattern:
 *   const scope = await resolveActorScope(ctx, db)
 *   const order = await findOrderById(db, id)
 *   assertOrderAccess(order, scope)  // throws NotFoundError if out of scope
 */

import { NotFoundError } from "@/modules/auth/rbac";
import { type ActorScope } from "@/modules/auth/scope";

// Minimal order shape required for scope checking.
// Replace with the actual OrderRow type once the order repository is merged in.
type OrderForScope = {
  applicantId: string;
  type: string;
  assignments: { factoryId: string }[];
};

// ---------------------------------------------------------------------------
// Scope check for a single fetched order
// ---------------------------------------------------------------------------

/**
 * Verifies the caller has access to the given order based on their scope.
 * Returns 404 (not found) instead of 403 on failure to avoid leaking existence.
 *
 * - SALES:      must be the applicant (applicantId === userId)
 * - ADMIN:      order must have at least one assignment in their factory
 * - SUPERADMIN: order type must match their production type group
 */
export function assertOrderAccess(order: OrderForScope, scope: ActorScope): void {
  switch (scope.role) {
    case "SALES":
      if (order.applicantId !== scope.userId) {
        throw new NotFoundError("Order not found.");
      }
      break;

    case "ADMIN":
      if (!order.assignments.some((a) => a.factoryId === scope.factoryId)) {
        throw new NotFoundError("Order not found.");
      }
      break;

    case "SUPERADMIN":
      if (order.type !== scope.group) {
        throw new NotFoundError("Order not found.");
      }
      break;
  }
}
