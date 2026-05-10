/**
 * app/api/users/route.ts
 *
 * GET  /api/users   — list users (SUPERADMIN only, scoped to own type)
 * POST /api/users   — create user (SUPERADMIN only, scoped to own type)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import { ForbiddenError, NotFoundError, forbiddenResponse, unauthorizedResponse, badRequestResponse, notFoundResponse } from "@/modules/auth/rbac";
import { listUsers, createUserService } from "@/modules/users/user-service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UserRoleSchema = z.enum(["SUPERADMIN", "ADMIN", "SALES"]);

const ListUsersQuerySchema = z.object({
  role: UserRoleSchema.optional(),
});

const CreateUserBodySchema = z.object({
  name: z.string().min(1, "name is required"),
  role: UserRoleSchema,
  group: z.string().min(1).optional().nullable(),
});

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = ListUsersQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return badRequestResponse("Invalid query parameters.", parsed.error.flatten().fieldErrors as Record<string, unknown>);
    }

    const items = await listUsers(ctx, prisma, { role: parsed.data.role });
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = CreateUserBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Invalid request body.", parsed.error.flatten().fieldErrors as Record<string, unknown>);
    }

    const result = await createUserService(ctx, prisma, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    if (err instanceof NotFoundError) return notFoundResponse(err.message);
    throw err;
  }
}
