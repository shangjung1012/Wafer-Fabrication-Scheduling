import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logout } from "@/modules/auth/auth-service";
import {
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  getCookieValue,
} from "@/app/api/auth/_cookies";
import {
  authErrorResponse,
  parseJsonError,
  validationErrorResponse,
} from "@/app/api/auth/_shared";

const LogoutBodySchema = z.object({
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

      const parsed = LogoutBodySchema.safeParse(body);
      if (!parsed.success) {
        return validationErrorResponse(parsed.error);
      }
      refreshToken = parsed.data.refreshToken;
    }

    const result = await logout(prisma, { refreshToken });
    const response = NextResponse.json(result);
    clearAuthCookies(response);
    return response;
  } catch (err) {
    const response = authErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
