import { randomUUID } from "crypto";
import type { RequestContext } from "@/modules/auth/request-context";
import { verifyAccessToken } from "@/modules/auth/token-service";
import { ACCESS_TOKEN_COOKIE, getCookieValue } from "@/app/api/auth/_cookies";

function parseBearerToken(request: Request): string | null {
  const raw =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (!raw) return null;

  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseAccessToken(request: Request): string | null {
  return (
    parseBearerToken(request) ?? getCookieValue(request, ACCESS_TOKEN_COOKIE)
  );
}

function getRequestId(request: Request): string {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("X-Request-Id") ??
    randomUUID()
  );
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
 * Verifies signed JWT access tokens and returns their identity payload.
 */
export async function requireAuth(request: Request): Promise<RequestContext> {
  const requestId = getRequestId(request);
  const token = parseAccessToken(request);

  if (!token) {
    throw new UnauthorizedError();
  }

  try {
    const payload = await verifyAccessToken(token);
    return {
      requestId,
      user: {
        id: payload.sub,
        role: payload.role,
        accountId: payload.accountId,
      },
    };
  } catch {
    throw new UnauthorizedError();
  }
}
