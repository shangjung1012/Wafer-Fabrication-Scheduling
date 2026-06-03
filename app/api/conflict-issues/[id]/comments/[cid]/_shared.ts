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
  badRequestResponse,
  notFoundResponse,
} from "@/modules/auth/rbac";
import { prisma } from "@/lib/prisma";
import type { RequestContext } from "@/modules/auth/request-context";

export async function handleCommentAction(
  req: NextRequest,
  params: Promise<{ id: string; cid: string }>,
  action: (ctx: RequestContext, cid: string) => Promise<void>,
) {
  const { cid } = await params;
  try {
    const ctx = await requireAuth(req);
    await action(ctx, cid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    if (e.status === 400)
      return badRequestResponse(e.message ?? "Bad request.");
    if (e.status === 409)
      return NextResponse.json({ error: e.message }, { status: 409 });
    throw err;
  }
}

export { prisma };
