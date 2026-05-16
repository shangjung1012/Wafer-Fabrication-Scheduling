import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import Redis from "ioredis";
import { runSchedule } from "@/modules/schedule/engine";
import { renderAndSend } from "@/modules/mail/mail-template";
import { kickOutTemplate } from "@/modules/mail/templates/kick-out";

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
  algorithm: z.string().optional(),
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

    const { type, algorithm } = parsed.data;
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
      const conflicts = await runSchedule(type, algorithm);
      let emailsSent = false;
      let emailFailures = 0;

      // Auto-send mode: fire emails immediately without admin confirmation
      const autoSend = process.env.CONFLICT_EMAIL_AUTO_SEND === "true";
      if (autoSend && conflicts.length > 0) {
        const emailJobs = conflicts.flatMap((o) => {
          const jobs = [];
          if (o.applicantEmail) {
            jobs.push(
              renderAndSend(kickOutTemplate, {
                orderName: o.name,
                applicantEmail: o.applicantEmail,
                applicantUsername: o.applicantUsername,
              }),
            );
          }
          if (o.adminEmail) {
            jobs.push(
              renderAndSend(kickOutTemplate, {
                orderName: o.name,
                applicantEmail: o.adminEmail,
                applicantUsername: o.adminUsername,
              }),
            );
          }
          return jobs;
        });
        const emailResults = await Promise.allSettled(emailJobs);
        emailResults.forEach((r, i) => {
          if (r.status === "rejected") {
            console.error(`Conflict email failed (job ${i}):`, r.reason);
            emailFailures += 1;
          }
        });
        emailsSent = emailJobs.length > 0 && emailFailures === 0;
      }

      return NextResponse.json({
        message: "Schedule run successfully",
        conflicts,
        emailsSent,
        emailFailures,
      });
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
