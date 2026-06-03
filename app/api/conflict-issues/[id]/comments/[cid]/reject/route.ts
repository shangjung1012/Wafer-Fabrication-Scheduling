/**
 * app/api/conflict-issues/[id]/comments/[cid]/reject/route.ts
 *
 * POST /api/conflict-issues/:id/comments/:cid/reject  — reject a proposal (opposite-role)
 */

import { NextRequest } from "next/server";
import { rejectProposal } from "@/modules/order/conflict-issue-service";
import { handleCommentAction, prisma } from "../_shared";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  return handleCommentAction(req, params, (ctx, cid) =>
    rejectProposal(ctx, prisma, cid),
  );
}
