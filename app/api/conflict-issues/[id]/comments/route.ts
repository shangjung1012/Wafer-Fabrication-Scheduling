/**
 * app/api/conflict-issues/[id]/comments/route.ts
 *
 * POST /api/conflict-issues/:id/comments  — add a comment (participant)
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
  addComment,
  getConflictIssue,
} from "@/modules/order/conflict-issue-service";
import { prisma } from "@/lib/prisma";

const ProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("REDUCE_QUANTITY"),
    newQuantity: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("DELAY_DUE_DATE"),
    newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
  }),
  z.object({ kind: z.literal("CANCEL") }),
]);

const PostCommentBodySchema = z.object({
  body: z.string().min(1, "body is required"),
  proposal: ProposalSchema.optional(),
  expectedOrderUpdatedAt: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

    const parsed = PostCommentBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    if (parsed.data.proposal && !parsed.data.expectedOrderUpdatedAt) {
      return badRequestResponse(
        "expectedOrderUpdatedAt is required when attaching a proposal.",
      );
    }

    const issue = await getConflictIssue(ctx, prisma, number);
    const comment = await addComment(ctx, prisma, issue.id, parsed.data);
    return NextResponse.json(comment, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    if (e.status === 400)
      return badRequestResponse(e.message ?? "Bad request.");
    throw err;
  }
}
