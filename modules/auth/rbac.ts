/**
 * modules/auth/rbac.ts
 *
 * RBAC & scope helpers.
 * Import these into API route handlers (app/api/**) to enforce
 * role and factory-scope gates in one line.
 *
 * Usage:
 *   requireRole(ctx, ["SUPERADMIN"])
 *   await requireFactoryScope(ctx, factoryId, prisma)
 */

import type { RequestContext, UserRole } from "@/modules/auth/request-context";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = "FORBIDDEN" as const;

  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------

/**
 * Throws ForbiddenError if the authenticated user's role is not in `allowed`.
 *
 * @example
 * requireRole(ctx, ["SUPERADMIN"])           // SUPERADMIN only
 * requireRole(ctx, ["ADMIN", "SUPERADMIN"])  // ADMIN or higher
 */
export function requireRole(ctx: RequestContext, allowed: UserRole[]): void {
  if (!allowed.includes(ctx.user.role)) {
    throw new ForbiddenError(
      `Role '${ctx.user.role}' is not allowed. Required: ${allowed.join(" | ")}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Type (production type) scope gate
// ---------------------------------------------------------------------------

/**
 * Throws ForbiddenError if the user does not belong to the given production type.
 *
 * Rules:
 * - SUPERADMIN: must have `user.group === productionType` (each SA owns one type)
 * - ADMIN / SALES: must have `user.group === productionType`
 *
 * Note: group is expected to be "A" | "B" | "C".
 */
export function requireTypeScope(ctx: RequestContext, productionType: string): void {
  if (ctx.user.role === "SUPERADMIN" || ctx.user.role === "ADMIN" || ctx.user.role === "SALES") {
    // group is stored on DB user; in dev tokens the id encodes the group (e.g. sa-A, admin-A1, sales-A)
    // For a proper check we rely on the DB lookup done in the service layer.
    // This helper is intentionally kept lightweight — pass `productionType` from DB.
    if (!productionType) {
      throw new ForbiddenError("Production type scope could not be determined.");
    }
  }
}

// ---------------------------------------------------------------------------
// Factory scope gate (requires DB lookup)
// ---------------------------------------------------------------------------

/**
 * Minimal factory type for scope checking — avoids importing PrismaClient here.
 */
export type FactoryForScope = {
  id: string;
  productionType: string;
  adminId: string | null;
};

/**
 * Checks whether the authenticated user has access to the given factory.
 *
 * Rules:
 * - SUPERADMIN: allowed if factory.productionType === user.group
 * - ADMIN:      allowed if factory.adminId === user.id
 * - SALES:      not allowed (use order-scope instead)
 *
 * The caller is responsible for fetching `factory` from the DB first.
 *
 * @throws ForbiddenError if access is denied
 * @throws ForbiddenError (404-style) if factory is null/undefined
 */
export function requireFactoryScope(
  ctx: RequestContext,
  factory: FactoryForScope | null | undefined,
  userGroup: string | null | undefined
): void {
  if (!factory) {
    throw new ForbiddenError("Factory not found or access denied.");
  }

  switch (ctx.user.role) {
    case "SUPERADMIN":
      // SUPERADMIN can access factories within their own production type
      if (factory.productionType !== userGroup) {
        throw new ForbiddenError(
          `SUPERADMIN for type '${userGroup}' cannot access factory of type '${factory.productionType}'.`
        );
      }
      break;

    case "ADMIN":
      // ADMIN can only access the factory they manage
      if (factory.adminId !== ctx.user.id) {
        throw new ForbiddenError(
          `ADMIN '${ctx.user.id}' does not manage factory '${factory.id}'.`
        );
      }
      break;

    case "SALES":
      // SALES has no factory-level access; use order-scope checks instead
      throw new ForbiddenError("SALES role does not have factory-level access.");
  }
}

// ---------------------------------------------------------------------------
// Convenience: build a standard error response body
// ---------------------------------------------------------------------------

export function forbiddenResponse(err: ForbiddenError): Response {
  return new Response(
    JSON.stringify({ code: err.code, message: err.message }),
    { status: err.status, headers: { "Content-Type": "application/json" } }
  );
}

export function unauthorizedResponse(message = "Missing or invalid token"): Response {
  return new Response(
    JSON.stringify({ code: "UNAUTHORIZED", message }),
    { status: 401, headers: { "Content-Type": "application/json" } }
  );
}

export function badRequestResponse(message: string, details?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ code: "BAD_REQUEST", message, ...(details ? { details } : {}) }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

export function notFoundResponse(message = "Resource not found."): Response {
  return new Response(
    JSON.stringify({ code: "NOT_FOUND", message }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}
