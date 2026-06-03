import { NextResponse } from "next/server";
import { requireAuth } from "@/modules/auth/require-auth";
import { z } from "zod";
import { runScheduleWithIssues } from "@/modules/order/schedule-orchestrator";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { getTime } from "@/lib/get-time";
import { prisma } from "@/lib/prisma";
import { assertCanManageScheduleType } from "@/modules/schedule/access-control";
import { OrderTypeSchema } from "@/modules/order/order-validation";
import {
  SchedulingConfigSchema,
  handleScheduleError,
} from "@/app/api/schedule/_shared";

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
    return handleScheduleError(error, "run schedule");
  }
}
