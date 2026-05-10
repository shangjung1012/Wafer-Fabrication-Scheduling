/**
 * app/api/users/route.ts
 *
 * GET  /api/users   — list users (ADMIN: SALES only | SUPERADMIN: all roles, scoped to own type)
 * POST /api/users   — create user (ADMIN: SALES only | SUPERADMIN: any role, scoped to own type)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/modules/auth/with-auth";
import { badRequestResponse } from "@/modules/auth/rbac";
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
  accountId: z.string().min(1, "accountId is required"),
  name: z.string().min(1, "name is required"),
  role: UserRoleSchema,
  group: z.string().min(1).optional().nullable(),
  password: z.string().min(8).max(256).optional().nullable(),
});

// ---------------------------------------------------------------------------
// GET /api/users
// ---------------------------------------------------------------------------

export const GET = withAuth<NextRequest>(async (req, ctx) => {
  const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListUsersQuerySchema.safeParse(queryParams);
  if (!parsed.success) {
    return badRequestResponse("Invalid query parameters.", parsed.error.flatten().fieldErrors as Record<string, unknown>);
  }

  const items = await listUsers(ctx, prisma, { role: parsed.data.role });
  return NextResponse.json({ items });
});

// ---------------------------------------------------------------------------
// POST /api/users
// ---------------------------------------------------------------------------

export const POST = withAuth<NextRequest>(async (req, ctx) => {
  try {
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
    const appErr = err as { status?: number; code?: string; message?: string };
    if (appErr.status === 404) {
      return new Response(
        JSON.stringify({ code: appErr.code ?? "NOT_FOUND", message: appErr.message }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    throw err;
  }
});
