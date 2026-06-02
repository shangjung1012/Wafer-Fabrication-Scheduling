import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { triggerAutoSchedule } from "@/modules/schedule/auto-scheduler";
import { getTime } from "@/lib/get-time";

const tz = process.env.CRON_TIMEZONE || "Asia/Taipei";

// === Startup Configuration Validation (fix #5) ===
function validateConfiguration(): void {
  const required = [
    { name: "BUSINESS_TIMEZONE_OFFSET", hint: "required by getTime()" },
    { name: "REDIS_URL", hint: "required by distributed locks" },
  ];
  const missing = required.filter((v) => !process.env[v.name]);
  if (missing.length > 0) {
    console.error("[Cron] Missing required environment variables:");
    missing.forEach((v) => console.error(`  - ${v.name} (${v.hint})`));
    process.exit(1);
  }
  if (!process.env.CRON_TIMEZONE) {
    console.warn("[Cron] CRON_TIMEZONE not set, defaulting to Asia/Taipei");
  }
}

validateConfiguration();

// === Overlap Prevention (fix #4) ===
let autoSchedulerRunning = false;
let dailyExecutionRunning = false;

// === Graceful Shutdown (fix #1) ===
let shuttingDown = false;
const activeTasks: Set<Promise<void>> = new Set();

function track<T>(promise: Promise<T>): Promise<T> {
  activeTasks.add(promise as Promise<void>);
  return promise.finally(() => activeTasks.delete(promise as Promise<void>));
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Cron] Received ${signal}. Shutting down gracefully...`);

  cron.getTasks().forEach((task) => task.stop());
  console.log("[Cron] Scheduler paused. No new jobs will fire.");

  if (activeTasks.size > 0) {
    console.log(
      `[Cron] Waiting for ${activeTasks.size} active task(s) to finish...`,
    );
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("shutdown timeout")), 30_000),
    );
    await Promise.race([
      Promise.allSettled(Array.from(activeTasks)),
      timeout,
    ]).catch(() => {
      console.warn("[Cron] Shutdown timed out after 30s. Forcing exit.");
    });
  }

  await prisma.$disconnect();
  console.log("[Cron] Prisma disconnected. Goodbye.");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// === Cron Jobs ===

export async function runAutoSchedulerCron() {
  if (autoSchedulerRunning) {
    console.log("[Cron] AutoScheduler already running, skipping this tick.");
    return;
  }
  autoSchedulerRunning = true;
  try {
    const state = await prisma.systemState.findUnique({
      where: { id: "global" },
    });
    if (state?.isSimulationMode) return;

    const currentDate = await getTime();
    await triggerAutoSchedule(currentDate);
  } catch (error) {
    console.error("[Cron] Top-level failure in AutoScheduler:", error);
  } finally {
    autoSchedulerRunning = false;
  }
}

export async function runDailyExecutionCron() {
  if (dailyExecutionRunning) {
    console.log("[Cron] Daily Execution already running, skipping this tick.");
    return;
  }
  dailyExecutionRunning = true;
  try {
    const state = await prisma.systemState.findUnique({
      where: { id: "global" },
    });
    if (state?.isSimulationMode) return;

    console.log("[Cron] Running Daily Execution Engine...");
    const currentDate = await getTime();
    await advanceOrderStatuses(currentDate);
    console.log("[Cron] Daily Execution Engine completed.");
  } catch (error) {
    console.error("[Cron] Failed Daily Execution Engine:", error);
  } finally {
    dailyExecutionRunning = false;
  }
}

console.log(`[Cron] Worker started with timezone ${tz}.`);

cron.schedule("0 2-22/2 * * *", () => track(runAutoSchedulerCron()), {
  timezone: tz,
});
cron.schedule("0 0 * * *", () => track(runDailyExecutionCron()), {
  timezone: tz,
});
