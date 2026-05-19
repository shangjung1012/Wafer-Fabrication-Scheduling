/**
 * app/api/conflict-issues/[id]/suggestions/route.ts
 *
 * GET /api/conflict-issues/:id/suggestions  — compute scheduling suggestions (participant)
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
} from "@/modules/auth/rbac";
import { getSuggestions } from "@/modules/order/conflict-issue-service";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const number = parseInt(id, 10);
  if (isNaN(number)) return notFoundResponse("Invalid issue number.");

  try {
    const ctx = await requireAuth(req);
    const suggestions = await getSuggestions(ctx, prisma, number);
    return NextResponse.json(suggestions);
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
