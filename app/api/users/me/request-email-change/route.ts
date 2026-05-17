import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { verifyPassword } from "@/modules/auth/password-service";
import { renderAndSend } from "@/modules/mail/mail-template";
import { emailChangeVerifyTemplate } from "@/modules/mail/templates/email-change-verify";
import { emailChangeNotifyTemplate } from "@/modules/mail/templates/email-change-notify";
import { prisma } from "@/lib/prisma";

const RequestEmailChangeSchema = z
  .object({
    newEmail: z.string().email("Invalid email address"),
    currentPassword: z.string().min(1, "Current password is required"),
  })
  .strict();

const TOKEN_TTL_MS = 3 * 60 * 1000; // 3 minutes

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

    const parsed = RequestEmailChangeSchema.safeParse(body);
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

    const { newEmail, currentPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { password: true, email: true, username: true },
    });

    if (!user?.password) {
      return NextResponse.json(
        { code: "BAD_REQUEST", message: "Account has no password set." },
        { status: 400 },
      );
    }

    const passwordValid = await verifyPassword(user.password, currentPassword);
    if (!passwordValid) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: "Current password is incorrect." },
        { status: 401 },
      );
    }

    if (newEmail === user.email) {
      return NextResponse.json(
        {
          code: "BAD_REQUEST",
          message: "New email is the same as your current email.",
        },
        { status: 400 },
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: newEmail },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { code: "CONFLICT", message: "Email is already in use." },
        { status: 409 },
      );
    }

    // Delete any existing pending token for this user (latest always wins)
    await prisma.emailChangeToken.deleteMany({
      where: { userId: ctx.user.id },
    });

    const token = await prisma.emailChangeToken.create({
      data: {
        userId: ctx.user.id,
        newEmail,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
      select: { token: true },
    });

    const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const verifyUrl = `${appUrl}/api/users/me/verify-email?token=${token.token}`;

    // Send both emails concurrently; don't fail the request if email sending fails
    await Promise.allSettled([
      renderAndSend(emailChangeVerifyTemplate, {
        newEmail,
        username: user.username,
        verifyUrl,
      }),
      renderAndSend(emailChangeNotifyTemplate, {
        oldEmail: user.email,
        newEmail,
        username: user.username,
      }),
    ]);

    return NextResponse.json({
      message:
        "Verification email sent. Please check your new inbox — the link expires in 3 minutes.",
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

    console.error("Error requesting email change:", error);
    return NextResponse.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to request email change.",
      },
      { status: 500 },
    );
  }
}
