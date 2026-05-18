/**
 * app/api/conflicts/[id]/requeue/route.ts
 *
 * POST /api/conflicts/:id/requeue — admin returns order to PENDING for rescheduling
 * without applying any changes.
 *
 * Body:
 *   note string (optional)
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
import { requeueConflict } from "@/modules/order/conflict-service";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  note: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    await requeueConflict(ctx, prisma, id, parsed.data.note);
    return NextResponse.json({ success: true });
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
