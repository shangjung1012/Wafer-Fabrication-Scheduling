/**
 * app/api/requests/[id]/approve/route.ts
 *
 * POST  /api/requests/[id]/approve   — approve a request and apply its payload to the linked order (ADMIN only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import {
  ForbiddenError,
  forbiddenResponse,
  unauthorizedResponse,
  notFoundResponse,
} from "@/modules/auth/rbac";
import { approveRequest } from "@/modules/order/request-service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// POST /api/requests/[id]/approve
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req);

    const result = await approveRequest(ctx, prisma, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}
