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

export class NotFoundError extends Error {
  readonly status = 404 as const;
  readonly code = "NOT_FOUND" as const;

  constructor(message = "Resource not found.") {
    super(message);
    this.name = "NotFoundError";
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
      `Role '${ctx.user.role}' is not allowed. Required: ${allowed.join(" | ")}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Convenience: build a standard error response body
// ---------------------------------------------------------------------------

export function forbiddenResponse(err: ForbiddenError): Response {
  return new Response(
    JSON.stringify({ code: err.code, message: err.message }),
    { status: err.status, headers: { "Content-Type": "application/json" } },
  );
}

export function unauthorizedResponse(
  message = "Missing or invalid token",
): Response {
  return new Response(JSON.stringify({ code: "UNAUTHORIZED", message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function csrfResponse(
  message = "Request origin is not allowed.",
): Response {
  return new Response(JSON.stringify({ code: "CSRF_FORBIDDEN", message }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export function badRequestResponse(
  message: string,
  details?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({
      code: "BAD_REQUEST",
      message,
      ...(details ? { details } : {}),
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

export function notFoundResponse(message = "Resource not found."): Response {
  return new Response(JSON.stringify({ code: "NOT_FOUND", message }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
