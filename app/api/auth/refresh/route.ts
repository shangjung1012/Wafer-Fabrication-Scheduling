import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { refresh } from "@/modules/auth/auth-service";
import { requireSameOriginForCookieAuth } from "@/modules/auth/require-auth";
import {
  REFRESH_TOKEN_COOKIE,
  getCookieValue,
  setAuthCookies,
} from "@/app/api/auth/_cookies";
import {
  authErrorResponse,
  parseJsonError,
  validationErrorResponse,
} from "@/app/api/auth/_shared";

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export async function POST(req: Request) {
  try {
    const cookieRefreshToken = getCookieValue(req, REFRESH_TOKEN_COOKIE);
    let refreshToken = cookieRefreshToken;
    if (!refreshToken) {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return parseJsonError();
      }

      const parsed = RefreshBodySchema.safeParse(body);
      if (!parsed.success) {
        return validationErrorResponse(parsed.error);
      }
      refreshToken = parsed.data.refreshToken;
    } else {
      requireSameOriginForCookieAuth(req);
    }

    const result = await refresh(prisma, { refreshToken });
    const response = NextResponse.json({ user: result.user });
    setAuthCookies(response, result);
    return response;
  } catch (err) {
    const response = authErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
