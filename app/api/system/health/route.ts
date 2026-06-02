import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

type DependencyStatus = {
  status: "ok" | "error";
  latencyMs: number;
  message?: string;
};

async function checkDependency(
  fn: () => Promise<unknown>,
): Promise<DependencyStatus> {
  const startedAt = Date.now();
  try {
    await fn();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      status: "error",
      latencyMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function GET() {
  const [database, redis] = await Promise.all([
    checkDependency(() => prisma.$queryRaw`SELECT 1`),
    checkDependency(() => getRedis().ping()),
  ]);

  const ok = database.status === "ok" && redis.status === "ok";

  return NextResponse.json(
    {
      status: ok ? "ok" : "unhealthy",
      dependencies: { database, redis },
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
