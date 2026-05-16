import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { verifyPassword } from "@/modules/auth/password-service";
import { prisma } from "@/lib/prisma";
import { updateUser } from "@/infra/db/user-repository";

const PatchMeSchema = z
  .object({
    email: z.string().email("Invalid email address"),
    currentPassword: z.string().min(1, "Current password is required"),
  })
  .strict();

export async function PATCH(request: Request) {
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

    const parsed = PatchMeSchema.safeParse(body);
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

    const { email, currentPassword } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { password: true },
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

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing && existing.id !== ctx.user.id) {
      return NextResponse.json(
        { code: "CONFLICT", message: "Email is already in use." },
        { status: 409 },
      );
    }

    await updateUser(prisma, ctx.user.id, { email });

    return NextResponse.json({ message: "Email updated successfully." });
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

    console.error("Error updating email:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to update email." },
      { status: 500 },
    );
  }
}
