/**
 * app/api/orders/[id]/cancel-request/route.ts
 *
 * POST /api/orders/:id/cancel-request
 * SALES: flag an order for cancellation → creates a ConflictIssue and emails admins.
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
import { createCancellationRequest } from "@/modules/order/conflict-issue-service";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  try {
    const ctx = await requireAuth(req);
    const result = await createCancellationRequest(ctx, prisma, orderId);
    return NextResponse.json(result, { status: 201 });
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
