import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { applyScheduleTransaction } from "@/modules/schedule/core";
import {
  type SchedulingConfig,
  type StrategyResult,
} from "@/modules/schedule/strategy";
import {
  getScheduleVersion,
  getPreview,
  deletePreview,
  incrementScheduleVersion,
} from "@/infra/redis/schedule-store";
import { createIssuesForFailedOrders } from "@/modules/order/conflict-issue-service";
import { getTime } from "@/lib/get-time";
import { prisma } from "@/lib/prisma";

const ApplyScheduleSchema = z.object({
  previewId: z.string().min(1, "Preview ID is required"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);

    if (ctx.user.role !== "SUPERADMIN" && ctx.user.role !== "ADMIN") {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = ApplyScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "BAD_REQUEST",
          message: "Invalid input",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

    const { previewId } = parsed.data;
    const previewPayload = await getPreview(previewId);

    if (!previewPayload) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Preview expired or not found" },
        { status: 404 },
      );
    }

    const type = previewPayload.type as string;
    const config = previewPayload.config as SchedulingConfig;
    const version = previewPayload.version as number;
    const result = previewPayload.result as StrategyResult;

    const currentVersion = await getScheduleVersion(type);

    if (version !== currentVersion) {
      return NextResponse.json(
        {
          code: "CONFLICT",
          message: "Schedule environment has changed. Please preview again.",
        },
        { status: 409 },
      );
    }

    const { failedIds } = await applyScheduleTransaction(
      type,
      config,
      result,
      ctx.user.id,
    );
    await incrementScheduleVersion(type);
    await deletePreview(previewId);

    if (failedIds.length > 0) {
      // Fire-and-forget: do NOT await — response must not block on issue
      // creation / email side effects. The service swallows per-order
      // failures; .catch is defensive against unexpected top-level throws.
      void createIssuesForFailedOrders({
        failedOrderIds: failedIds,
        actorId: ctx.user.id,
        runConfig: config,
        runAt: await getTime(),
        prisma,
      }).catch((err) => {
        console.error(
          "[apply] createIssuesForFailedOrders unexpected error:",
          err,
        );
      });
    }

    return NextResponse.json({ message: "Schedule applied successfully" });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message?.includes("already running") ||
        error.message?.includes("environment has changed"))
    ) {
      return NextResponse.json(
        { code: "CONFLICT", message: error.message },
        { status: 409 },
      );
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof CsrfError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    console.error("Error applying schedule:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to apply schedule" },
      { status: 500 },
    );
  }
}
