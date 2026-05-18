/**
 * app/api/conflicts/route.ts
 *
 * GET /api/conflicts — list orders with status=CONFLICT (role-scoped)
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
} from "@/modules/auth/rbac";
import { listConflicts } from "@/modules/order/conflict-service";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const conflicts = await listConflicts(ctx, prisma);
    return NextResponse.json(conflicts);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    throw err;
  }
}
