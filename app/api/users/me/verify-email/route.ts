import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import {
  confirmEmailChangeToken,
  EmailChangeError,
} from "@/modules/auth/email-change-service";
import { prisma } from "@/lib/prisma";

const VerifyEmailBodySchema = z
  .object({
    token: z.string().min(1, "token is required"),
  })
  .strict();

function profileRedirect(params: Record<string, string>): NextResponse {
  const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const url = new URL("/profile", appUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return profileRedirect({ emailError: "missing_token" });
  }

  return profileRedirect({ emailChangeToken: token });
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const parsed = VerifyEmailBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "BAD_REQUEST",
          message: "Invalid input.",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const result = await confirmEmailChangeToken(prisma, {
      userId: ctx.user.id,
      token: parsed.data.token,
    });

    return NextResponse.json({
      message: "Email updated successfully.",
      email: result.email,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof CsrfError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof EmailChangeError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }

    console.error("Error verifying email change:", error);
    return NextResponse.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to verify email change.",
      },
      { status: 500 },
    );
  }
}
