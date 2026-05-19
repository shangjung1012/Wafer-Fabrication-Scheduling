/**
 * app/api/conflict-issues/route.ts
 *
 * GET /api/conflict-issues  — list issues (scope derived from role)
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
import { listConflictIssues } from "@/modules/order/conflict-issue-service";
import { ConflictIssueStatus } from "@/infra/db/conflict-issue-repository";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const status =
      statusParam &&
      Object.values(ConflictIssueStatus).includes(
        statusParam as ConflictIssueStatus,
      )
        ? (statusParam as ConflictIssueStatus)
        : undefined;

    const issues = await listConflictIssues(ctx, prisma, {
      status,
    });
    return NextResponse.json(issues);
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
