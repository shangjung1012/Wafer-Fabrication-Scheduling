import { NextResponse } from "next/server";
import {
  accessTokenTtl,
  durationToMs,
  refreshTokenTtl,
} from "@/modules/auth/token-service";

export const ACCESS_TOKEN_COOKIE = "access_token";
export const REFRESH_TOKEN_COOKIE = "refresh_token";

const isProduction = process.env.NODE_ENV === "production";

const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax" as const,
  path: "/",
};

function maxAgeSeconds(ttl: string): number {
  return Math.floor(durationToMs(ttl) / 1000);
}

export function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string },
): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...authCookieOptions,
    maxAge: maxAgeSeconds(accessTokenTtl()),
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...authCookieOptions,
    maxAge: maxAgeSeconds(refreshTokenTtl()),
  });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", {
    ...authCookieOptions,
    maxAge: 0,
  });
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", {
    ...authCookieOptions,
    maxAge: 0,
  });
}

export function getCookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;

  for (const part of raw.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
}
