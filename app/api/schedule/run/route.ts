import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { runSchedule } from "@/modules/schedule/run";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { getTime } from "@/lib/get-time";
import { createIssuesForFailedOrders } from "@/modules/order/conflict-issue-service";
import { prisma } from "@/lib/prisma";

const SchedulingConfigSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    frozenDays: z.number().int().min(0).default(0),
    productionDays: z.number().int().min(1).default(1),
    bufferDays: z.number().int().min(0).default(0),
    reschedulePolicy: z
      .enum(["GLOBAL_OPTIMIZE", "PRIORITY_RETAIN", "GAP_FILLING"])
      .default("GAP_FILLING"),
    algorithm: z.enum(["GREEDY_BEST_FIT"]).default("GREEDY_BEST_FIT"),
    splittable: z.boolean().default(true),
    targetOrderIds: z.array(z.string()).optional(),
  })
  .default({
    frozenDays: 0,
    productionDays: 1,
    bufferDays: 0,
    reschedulePolicy: "GAP_FILLING",
    algorithm: "GREEDY_BEST_FIT",
    splittable: true,
  });

const RunScheduleSchema = z.object({
  type: z.string().min(1, "Type is required"),
  config: SchedulingConfigSchema,
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);

    // RBAC: Only SUPERADMIN and ADMIN can trigger the scheduling engine
    if (ctx.user.role !== "SUPERADMIN" && ctx.user.role !== "ADMIN") {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = RunScheduleSchema.safeParse(body);

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

    const { type, config } = parsed.data;

    // Only the lock winner pays the cost of resolving the simulation/current date.
    const currentDate = await getTime();
    currentDate.setHours(0, 0, 0, 0);

    if (!config.startDate) {
      const defaultStartDate = new Date(currentDate);
      defaultStartDate.setDate(defaultStartDate.getDate() + 1);
      config.startDate = defaultStartDate;
    }

    // Execute the actual scheduling engine logic
    const { failedIds } = await runSchedule(
      type,
      config as SchedulingConfig,
      currentDate,
      ctx.user.id,
    );

    if (failedIds.length > 0) {
      // Fire-and-forget: do NOT await — response must not block on issue
      // creation / email side effects. Cron worker calls `runSchedule`
      // directly (see scripts/cron.ts), bypassing this route, so the actor
      // here is always the authenticated admin from requireAuth.
      void createIssuesForFailedOrders({
        failedOrderIds: failedIds,
        actorId: ctx.user.id,
        runConfig: config as SchedulingConfig,
        runAt: currentDate,
        prisma,
      }).catch((err) => {
        console.error(
          "[run] createIssuesForFailedOrders unexpected error:",
          err,
        );
      });
    }

    return NextResponse.json({ message: "Schedule run successfully" });
  } catch (error: unknown) {
    if (error instanceof Error && error.message?.includes("already running")) {
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

    console.error("Error running schedule:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to run schedule" },
      { status: 500 },
    );
  }
}
