import { randomUUID } from "crypto";
import type { RequestContext } from "@/modules/auth/request-context";
import { verifyAccessToken } from "@/modules/auth/token-service";
import { getAuthSession } from "@/modules/auth/session-store";
import { ACCESS_TOKEN_COOKIE, getCookieValue } from "@/app/api/auth/_cookies";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type ParsedAccessToken = {
  token: string;
  source: "bearer" | "cookie";
};

function parseBearerToken(request: Request): string | null {
  const raw =
    request.headers.get("authorization") ??
    request.headers.get("Authorization");
  if (!raw) return null;

  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseAccessToken(request: Request): ParsedAccessToken | null {
  const bearerToken = parseBearerToken(request);
  if (bearerToken) {
    return { token: bearerToken, source: "bearer" };
  }

  const cookieToken = getCookieValue(request, ACCESS_TOKEN_COOKIE);
  if (cookieToken) {
    return { token: cookieToken, source: "cookie" };
  }

  return null;
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

export class CsrfError extends Error {
  readonly status = 403 as const;
  readonly code = "CSRF_FORBIDDEN" as const;

  constructor(message = "Request origin is not allowed.") {
    super(message);
    this.name = "CsrfError";
  }
}

function expectedAppOrigin(): string {
  const value = process.env.APP_BASE_URL?.trim();
  if (!value) {
    throw new CsrfError("APP_BASE_URL is required for CSRF protection.");
  }
  return new URL(value).origin;
}

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      return null;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  return null;
}

export function requireSameOriginForCookieAuth(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const actualOrigin = requestOrigin(request);
  if (!actualOrigin || actualOrigin !== expectedAppOrigin()) {
    throw new CsrfError();
  }
}

/**
 * Server-side authentication entry point.
 *
 * Verifies signed JWT access tokens and returns their identity payload.
 */
export async function requireAuth(request: Request): Promise<RequestContext> {
  const requestId = getRequestId(request);
  const parsedToken = parseAccessToken(request);

  if (!parsedToken) {
    throw new UnauthorizedError();
  }
  if (parsedToken.source === "cookie") {
    requireSameOriginForCookieAuth(request);
  }

  try {
    const payload = await verifyAccessToken(parsedToken.token);
    const session = await getAuthSession(payload.sid);
    if (!session || session.userId !== payload.sub) {
      throw new Error("Invalid auth session.");
    }

    return {
      requestId,
      user: {
        id: payload.sub,
        role: payload.role,
        username: payload.username,
      },
    };
  } catch {
    throw new UnauthorizedError();
  }
}
