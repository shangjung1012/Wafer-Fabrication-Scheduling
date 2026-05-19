/**
 * app/api/conflict-issues/[id]/route.ts
 *
 * GET   /api/conflict-issues/:number  — get issue detail (by number)
 * PATCH /api/conflict-issues/:number  — update status (ADMIN only)
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
  csrfResponse,
  forbiddenResponse,
  unauthorizedResponse,
  badRequestResponse,
  notFoundResponse,
} from "@/modules/auth/rbac";
import {
  getConflictIssue,
  updateIssueStatus,
} from "@/modules/order/conflict-issue-service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// GET /api/conflict-issues/:id  (id = issue number)
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const number = parseInt(id, 10);

  if (isNaN(number)) return notFoundResponse("Invalid issue number.");

  try {
    const ctx = await requireAuth(req);
    const issue = await getConflictIssue(ctx, prisma, number);
    return NextResponse.json(issue);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/conflict-issues/:id  (admin actions: close / reopen / reassign)
// ---------------------------------------------------------------------------

const PatchBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CLOSE") }),
  z.object({ action: z.literal("REOPEN") }),
  z.object({ action: z.literal("REASSIGN"), assigneeId: z.string().min(1) }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // id here is the issue number (for consistency with GET), but updateIssueStatus needs the DB id.
  // We'll look up the issue first in the service (by number) then pass the DB id.
  const number = parseInt(id, 10);
  if (isNaN(number)) return notFoundResponse("Invalid issue number.");

  try {
    const ctx = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = PatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    // Look up the issue to get its DB id
    const issue = await getConflictIssue(ctx, prisma, number);
    await updateIssueStatus(ctx, prisma, issue.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    if (e.status === 409) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw err;
  }
}
