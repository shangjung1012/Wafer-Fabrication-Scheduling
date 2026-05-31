import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { runScheduleWithIssues } from "@/modules/order/schedule-orchestrator";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { getTime } from "@/lib/get-time";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/modules/auth/rbac";
import { assertCanManageScheduleType } from "@/modules/schedule/access-control";
import { OrderTypeSchema } from "@/modules/order/order-validation";

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

const RunScheduleSchema = z
  .object({
    type: OrderTypeSchema,
    config: SchedulingConfigSchema,
  })
  .strict();

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
    await assertCanManageScheduleType(ctx, prisma, type);

    // Only the lock winner pays the cost of resolving the simulation/current date.
    const currentDate = await getTime();

    await runScheduleWithIssues({
      type,
      config: config as SchedulingConfig,
      currentDate,
      operatorId: ctx.user.id,
    });

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
    if (error instanceof ForbiddenError) {
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
