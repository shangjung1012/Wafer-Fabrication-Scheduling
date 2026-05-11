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
import {
  InvitationError,
  resendUserInvitation,
} from "@/modules/auth/invitation-service";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;
    const result = await resendUserInvitation(ctx, prisma, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    if (err instanceof InvitationError) {
      return NextResponse.json(
        { code: err.code, message: err.message },
        { status: err.status },
      );
    }
    throw err;
  }
}
