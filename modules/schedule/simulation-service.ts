import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { triggerAutoSchedule } from "@/modules/schedule/auto-scheduler";
import { upsertSystemState } from "@/infra/db/system-state-repository";
import { revertSimulationStatuses } from "@/infra/db/daily-execution-repository";
import { prisma } from "@/lib/prisma";

export async function handleSimulationRevert(
  realToday: Date,
  patch?: { isSimulationMode?: boolean; simulationDate?: Date | null },
): Promise<void> {
  await revertSimulationStatuses(realToday, patch);
}

export async function handleSimulationTimeAdvance(
  oldTime: Date | null | undefined,
  newTime: Date,
  patch?: { isSimulationMode?: boolean; simulationDate?: Date | null },
) {
  const crossedMidnight = oldTime
    ? oldTime.getUTCFullYear() !== newTime.getUTCFullYear() ||
      oldTime.getUTCMonth() !== newTime.getUTCMonth() ||
      oldTime.getUTCDate() !== newTime.getUTCDate()
    : true;

  if (crossedMidnight) {
    await advanceOrderStatuses(newTime, patch);
  } else {
    if (patch) {
      await upsertSystemState(prisma, patch);
    }
    await triggerAutoSchedule(newTime);
  }
}
