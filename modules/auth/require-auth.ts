import { randomUUID } from "crypto";
import type { RequestContext } from "@/modules/auth/request-context";

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

function devStaticTokenContext(token: string | null, requestId: string): RequestContext | null {
  if (process.env.NODE_ENV !== "development") return null;
  const expected = process.env.DEV_STATIC_TOKEN;
  if (!expected) return null;
  if (!token) return null;
  if (token !== expected) return null;

  return {
    requestId,
    user: {
      id: "dev-superadmin",
      role: "SUPERADMIN",
    },
  };
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
 * - In development, accepts DEV_STATIC_TOKEN as a SUPERADMIN user.
 * - Otherwise, throws UnauthorizedError until real JWT verification is implemented.
 */
export async function requireAuth(request: Request): Promise<RequestContext> {
  const requestId = getRequestId(request);
  const token = parseBearerToken(request);

  const devCtx = devStaticTokenContext(token, requestId);
  if (devCtx) return devCtx;

  // TODO: Implement HS256 JWT verification using JWT_SECRET.
  // Keep this function as the single entry point so all route handlers are consistent.
  throw new UnauthorizedError();
}

