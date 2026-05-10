import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import { ForbiddenError, forbiddenResponse, unauthorizedResponse } from "@/modules/auth/rbac";
import { getTimeline } from "@/modules/visualization/service";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const { searchParams } = req.nextUrl;
    const factoryId = searchParams.get("factoryId") ?? undefined;
    const startDate = searchParams.get("startDate") ?? undefined;
    const endDate   = searchParams.get("endDate")   ?? undefined;

    const data = await getTimeline(ctx, prisma, { factoryId, startDate, endDate });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError)    return forbiddenResponse(err);
    throw err;
  }
}
