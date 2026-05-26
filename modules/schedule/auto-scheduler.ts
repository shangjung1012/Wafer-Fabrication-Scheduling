import { prisma } from "@/lib/prisma";
import { runScheduleWithIssues } from "@/modules/order/schedule-orchestrator";
import { findPendingOrderTypes } from "@/infra/db/order-repository";
import { findUserByUsername } from "@/infra/db/user-repository";
import { getAutoSchedulerConfigByType } from "@/infra/db/auto-scheduler-config-repository";
import { type SchedulingConfig } from "@/modules/schedule/strategy";

export async function triggerAutoSchedule(currentDate: Date) {
  console.log("[AutoScheduler] Running AutoScheduler...");

  const pendingTypes = await findPendingOrderTypes(prisma);
  if (pendingTypes.length === 0) return;

  const systemUser = await findUserByUsername(prisma, "AutoScheduler");
  if (!systemUser) return;

  for (const type of pendingTypes) {
    try {
      const config = await getAutoSchedulerConfigByType(prisma, type);
      if (!config || !config.isOperating) {
        console.log(
          `[AutoScheduler] AutoScheduler is disabled for type ${type}. Skipping.`,
        );
        continue;
      }

      const defaultStartDate = new Date(currentDate);
      defaultStartDate.setUTCHours(0, 0, 0, 0);
      defaultStartDate.setUTCDate(defaultStartDate.getUTCDate() + 1);

      const scheduleConfig: SchedulingConfig = {
        startDate: defaultStartDate,
        frozenDays: config.frozenDays,
        productionDays: config.productionDays,
        bufferDays: config.bufferDays,
        reschedulePolicy: "GAP_FILLING",
        algorithm: config.algorithm as SchedulingConfig["algorithm"],
        splittable: config.splittable,
      };

      await runScheduleWithIssues({
        type,
        config: scheduleConfig,
        currentDate,
        operatorId: systemUser.id,
      });
      console.log(`[AutoScheduler] Successfully ran schedule for type ${type}`);
    } catch (error) {
      const err = error as Error;
      if (err.message?.includes("already running")) {
        console.log(
          `[AutoScheduler] Schedule already running for type ${type}. Skipping.`,
        );
      } else {
        console.error(`[AutoScheduler] Failed for type ${type}:`, err);
      }
    }
  }
}
