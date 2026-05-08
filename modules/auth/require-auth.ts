import { randomUUID } from "crypto";
import type { RequestContext } from "@/modules/auth/request-context";
import type { UserRole } from "@/modules/auth/request-context";

function parseBearerToken(request: Request): string | null {
  const raw = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!raw) return null;

  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getRequestId(request: Request): string {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("X-Request-Id") ??
    randomUUID()
  );
}

const VALID_ROLES: UserRole[] = ["SUPERADMIN", "ADMIN", "SALES"];

/**
 * Dev token resolution (development only).
 *
 * Supports two formats:
 *
 * 1. Legacy static token — `DEV_STATIC_TOKEN` env var (always resolves to SUPERADMIN).
 *    e.g.  Authorization: Bearer dev-superadmin-static-token
 *
 * 2. Role-encoded token — `dev:<ROLE>:<userId>`
 *    e.g.  Authorization: Bearer dev:SUPERADMIN:dev-sa-A
 *          Authorization: Bearer dev:ADMIN:dev-admin-A1
 *          Authorization: Bearer dev:SALES:dev-sales-1
 *
 * Both formats are only active when NODE_ENV === "development".
 */
function devTokenContext(token: string | null, requestId: string): RequestContext | null {
  if (process.env.NODE_ENV !== "development") return null;
  if (!token) return null;

  // Format 2: dev:<ROLE>:<userId>
  if (token.startsWith("dev:")) {
    const parts = token.split(":");
    // Expecting exactly 3 parts: "dev", role, userId
    if (parts.length === 3) {
      const [, roleRaw, userId] = parts;
      const role = roleRaw as UserRole;
      if (VALID_ROLES.includes(role) && userId.trim().length > 0) {
        return { requestId, user: { id: userId.trim(), role } };
      }
    }
    return null;
  }

  // Format 1: legacy DEV_STATIC_TOKEN (backward-compatible)
  const expected = process.env.DEV_STATIC_TOKEN;
  if (expected && token === expected) {
    return {
      requestId,
      user: { id: "dev-superadmin", role: "SUPERADMIN" },
    };
  }

  return null;
}

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  readonly code = "UNAUTHORIZED" as const;

  constructor(message = "Missing or invalid token") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Server-side authentication entry point.
 *
 * Behavior:
 * - In development, accepts `dev:<ROLE>:<userId>` tokens for any role,
 *   or the legacy DEV_STATIC_TOKEN (resolves to SUPERADMIN).
 * - Otherwise, throws UnauthorizedError until real JWT verification is implemented.
 */
export async function requireAuth(request: Request): Promise<RequestContext> {
  const requestId = getRequestId(request);
  const token = parseBearerToken(request);

  const devCtx = devTokenContext(token, requestId);
  if (devCtx) return devCtx;

  // TODO: Implement HS256 JWT verification using JWT_SECRET.
  // Keep this function as the single entry point so all route handlers are consistent.
  throw new UnauthorizedError();
}

