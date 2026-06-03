/**
 * app/api/conflict-issues/[id]/comments/[cid]/accept/route.ts
 *
 * POST /api/conflict-issues/:id/comments/:cid/accept  — accept a proposal (opposite-role)
 */

import { NextRequest } from "next/server";
import { acceptProposal } from "@/modules/order/conflict-issue-service";
import { handleCommentAction, prisma } from "../_shared";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  return handleCommentAction(req, params, (ctx, cid) =>
    acceptProposal(ctx, prisma, cid),
  );
}
