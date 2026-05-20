import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { runSchedule } from "@/modules/schedule/run";
import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { findPendingOrderTypes } from "@/infra/db/order-repository";
import { findUserByUsername } from "@/infra/db/user-repository";
import { getAutoSchedulerConfigByType } from "@/infra/db/auto-scheduler-config-repository";
import { getTime } from "@/lib/get-time";

import { type SchedulingConfig } from "@/modules/schedule/strategy";

async function runAutoScheduler() {
  try {
    console.log("[Cron] Running AutoScheduler...");

    const pendingTypes = await findPendingOrderTypes(prisma);
    if (pendingTypes.length === 0) return;

    const systemUser = await findUserByUsername(prisma, "AutoScheduler");
    if (!systemUser) return;

    const currentDate = await getTime();

    for (const type of pendingTypes) {
      try {
        const config = await getAutoSchedulerConfigByType(prisma, type);
        if (!config || !config.isOperating) {
          console.log(
            `[Cron] AutoScheduler is disabled for type ${type}. Skipping.`,
          );
          continue;
        }

        const defaultStartDate = new Date(currentDate);
        defaultStartDate.setHours(0, 0, 0, 0);
        defaultStartDate.setDate(defaultStartDate.getDate() + 1);

        const scheduleConfig: SchedulingConfig = {
          startDate: defaultStartDate,
          frozenDays: config.frozenDays,
          productionDays: config.productionDays,
          bufferDays: config.bufferDays,
          reschedulePolicy:
            config.reschedulePolicy as SchedulingConfig["reschedulePolicy"],
          algorithm: config.algorithm as SchedulingConfig["algorithm"],
          splittable: config.splittable,
        };

        // runSchedule natively handles its own locks securely
        await runSchedule(type, scheduleConfig, currentDate, systemUser.id);
        console.log(`[Cron] Successfully ran schedule for type ${type}`);
      } catch (error) {
        const err = error as Error;
        if (err.message?.includes("already running")) {
          console.log(
            `[Cron] Schedule already running for type ${type}. Skipping.`,
          );
        } else {
          console.error(`[Cron] Failed for type ${type}:`, err);
        }
      }
    }
  } catch (error) {
    console.error("[Cron] Top-level failure in AutoScheduler:", error);
  }
}

async function runDailyExecution() {
  try {
    console.log("[Cron] Running Daily Execution Engine...");
    const currentDate = await getTime();
    // advanceOrderStatuses natively handles its own locks securely
    await advanceOrderStatuses(currentDate);
    console.log("[Cron] Daily Execution Engine completed.");
  } catch (error) {
    console.error("[Cron] Failed Daily Execution Engine:", error);
  }
}

cron.schedule("0 */2 * * *", runAutoScheduler);
cron.schedule("0 0 * * *", runDailyExecution);
console.log("[Cron] Worker started.");
