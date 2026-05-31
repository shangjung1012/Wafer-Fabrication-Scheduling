/**
 * app/api/users/[id]/route.ts
 *
 * PATCH  /api/users/:id — update username, email, role, or group (SUPERADMIN)
 * DELETE /api/users/:id — remove a user account (SUPERADMIN)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import {
  ForbiddenError,
  badRequestResponse,
  csrfResponse,
  forbiddenResponse,
  notFoundResponse,
  unauthorizedResponse,
} from "@/modules/auth/rbac";
import {
  deleteUserService,
  updateUserService,
} from "@/modules/users/user-service";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const UserRoleSchema = z.enum(["SUPERADMIN", "ADMIN", "SALES"]);

const UpdateUserBodySchema = z
  .object({
    username: z.string().trim().min(1).optional(),
    email: z.string().trim().email("email must be valid").optional(),
    role: UserRoleSchema.optional(),
    group: z.string().trim().min(1, "group is required").optional(),
  })
  .strict();

function conflictResponse(error: unknown): Response | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return NextResponse.json(
      {
        code: "CONFLICT",
        message: "Username or email is already in use.",
      },
      { status: 409 },
    );
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    return NextResponse.json(
      {
        code: "CONFLICT",
        message: "User cannot be removed because related records still exist.",
      },
      { status: 409 },
    );
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = UpdateUserBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    if (Object.values(parsed.data).every((value) => value === undefined)) {
      return badRequestResponse("At least one field is required.");
    }

    const result = await updateUserService(ctx, prisma, id, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const conflict = conflictResponse(err);
    if (conflict) return conflict;
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const result = await deleteUserService(ctx, prisma, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const conflict = conflictResponse(err);
    if (conflict) return conflict;
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}
