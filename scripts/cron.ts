import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { triggerAutoSchedule } from "@/modules/schedule/auto-scheduler";
import { getTime } from "@/lib/get-time";

const tz = process.env.CRON_TIMEZONE || "Asia/Taipei";

export async function runAutoSchedulerCron() {
  try {
    const state = await prisma.systemState.findUnique({
      where: { id: "global" },
    });
    if (state?.isSimulationMode) return;

    const currentDate = await getTime();
    await triggerAutoSchedule(currentDate);
  } catch (error) {
    console.error("[Cron] Top-level failure in AutoScheduler:", error);
  }
}

export async function runDailyExecutionCron() {
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
  }
}

cron.schedule("0 */2 * * *", runAutoSchedulerCron, { timezone: tz });
cron.schedule("0 0 * * *", runDailyExecutionCron, { timezone: tz });
console.log(`[Cron] Worker started with timezone ${tz}.`);
