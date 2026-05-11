import { NextResponse } from "next/server";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import { z } from "zod";
import Redis from "ioredis";
import { runSchedule } from "@/modules/schedule/engine";

let redis: Redis | undefined;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    redis.on?.("error", (error) => {
      console.error("Redis connection error:", error);
    });
  }

  return redis;
}

const RunScheduleSchema = z.object({
  type: z.string().min(1, "Type is required"),
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

    const { type } = parsed.data;
    const lockKey = `schedule:lock:${type}`;
    const redis = getRedis();

    // Acquire Redis Lock (Fail-fast, 5-minute expiry)
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
      // Execute the actual scheduling engine logic
      await runSchedule(type);

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

    console.error("Error running schedule:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to run schedule" },
      { status: 500 },
    );
  }
}
