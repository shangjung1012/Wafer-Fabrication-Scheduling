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
import { createEmailChangeToken } from "@/modules/auth/email-change-service";
import { prisma } from "@/lib/prisma";

const RequestEmailChangeSchema = z
  .object({
    newEmail: z.string().email("Invalid email address"),
    currentPassword: z.string().min(1, "Current password is required"),
  })
  .strict();

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

    const token = await createEmailChangeToken(prisma, {
      userId: ctx.user.id,
      newEmail,
    });

    const appUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const verifyUrl = new URL("/api/users/me/verify-email", appUrl);
    verifyUrl.searchParams.set("token", token.token);

    // Send both emails concurrently; don't fail or block the request if email
    // delivery polling is slow after Azure has accepted the send operation.
    void Promise.allSettled([
      renderAndSend(emailChangeVerifyTemplate, {
        newEmail,
        username: user.username,
        verifyUrl: verifyUrl.toString(),
      }),
      renderAndSend(emailChangeNotifyTemplate, {
        oldEmail: user.email,
        newEmail,
        username: user.username,
      }),
    ]).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") {
          console.error(
            "Error sending email change notification:",
            result.reason,
          );
        }
      });
    });

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
