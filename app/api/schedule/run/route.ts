import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { getRedis } from "@/lib/redis";
import { runSchedule } from "@/modules/schedule/run";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { getTime } from "@/lib/get-time";

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
    // 1. Check for Cron execution first
    const authHeader = request.headers.get("Authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

    // 2. If not a valid cron, fallback to standard user Auth + RBAC
    if (!isCron) {
      const ctx = await requireAuth(request);

      // RBAC: Only SUPERADMIN and ADMIN can trigger the scheduling engine
      if (ctx.user.role !== "SUPERADMIN" && ctx.user.role !== "ADMIN") {
        return NextResponse.json(
          { code: "FORBIDDEN", message: "Insufficient permissions" },
          { status: 403 },
        );
      }
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

    // Handle the dynamic default for startDate (today + 1)
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    if (!config.startDate) {
      const defaultStartDate = new Date(currentDate);
      defaultStartDate.setDate(defaultStartDate.getDate() + 1);
      config.startDate = defaultStartDate;
    }

    const lockKey = `schedule:lock:${type}`;
    const redis = getRedis();

    // Acquire Redis Lock first (fail-fast for concurrent requests; must precede
    // any DB roundtrip so losers return 409 without waiting for getTime()).
    const lockAcquired = await redis.set(lockKey, "locked", "EX", 300, "NX");
    if (!lockAcquired) {
      return NextResponse.json(
        {
          code: "CONFLICT",
          message: "A scheduling process is already running for this type",
        },
        { status: 409 },
      );
    }

    try {
      // Only the lock winner pays the cost of resolving the simulation/current date.
      const currentDate = await getTime();
      currentDate.setHours(0, 0, 0, 0);

      if (!config.startDate) {
        const defaultStartDate = new Date(currentDate);
        defaultStartDate.setDate(defaultStartDate.getDate() + 1);
        config.startDate = defaultStartDate;
      }

      // Execute the actual scheduling engine logic
      await runSchedule(type, config as SchedulingConfig, currentDate);

      return NextResponse.json({ message: "Schedule run successfully" });
    } finally {
      // Always release the lock when done
      await redis.del(lockKey);
    }
  } catch (error) {
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
