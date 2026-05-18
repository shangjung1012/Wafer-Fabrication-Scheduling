/**
 * app/api/conflict-issues/[id]/comments/[cid]/reject/route.ts
 *
 * POST /api/conflict-issues/:id/comments/:cid/reject  — reject a proposal (opposite-role)
 */

import { NextRequest, NextResponse } from "next/server";
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
  notFoundResponse,
  badRequestResponse,
} from "@/modules/auth/rbac";
import { rejectProposal } from "@/modules/order/conflict-issue-service";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  const { cid } = await params;

  try {
    const ctx = await requireAuth(req);
    await rejectProposal(ctx, prisma, cid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    if (e.status === 400)
      return badRequestResponse(e.message ?? "Bad request.");
    if (e.status === 409) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw err;
  }
}
