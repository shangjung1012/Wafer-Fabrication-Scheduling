/**
 * app/api/conflicts/[id]/route.ts
 *
 * GET /api/conflicts/:id — get conflict order detail with comment thread
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
import { getConflict } from "@/modules/order/conflict-service";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req);
    const detail = await getConflict(ctx, prisma, id);
    return NextResponse.json(detail);
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
