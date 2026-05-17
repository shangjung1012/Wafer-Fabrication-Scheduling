import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request);

    const user = await prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        group: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "User not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ user });
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

    console.error("Error fetching current user:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch user." },
      { status: 500 },
    );
  }
}
