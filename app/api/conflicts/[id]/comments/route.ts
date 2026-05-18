/**
 * app/api/conflicts/[id]/comments/route.ts
 *
 * POST /api/conflicts/:id/comments — add a comment or proposal to a conflict thread
 *
 * Body:
 *   content      string (required)
 *   proposalData { newDueDate?, newQuantity?, targetFactoryNote? } (optional, SALES only)
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
import { addComment } from "@/modules/order/conflict-service";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({
  content: z.string().min(1, "content is required"),
  proposalData: z
    .object({
      newDueDate: z.string().optional(),
      newQuantity: z.number().int().positive().optional(),
      targetFactoryNote: z.string().optional(),
    })
    .optional(),
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
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    const comment = await addComment(ctx, prisma, id, parsed.data);
    return NextResponse.json(comment, { status: 201 });
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
