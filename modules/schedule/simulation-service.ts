import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { triggerAutoSchedule } from "@/modules/schedule/auto-scheduler";

export async function handleSimulationTimeAdvance(
  oldTime: Date | null | undefined,
  newTime: Date,
) {
  if (oldTime) {
    const crossedMidnight =
      oldTime.getUTCFullYear() !== newTime.getUTCFullYear() ||
      oldTime.getUTCMonth() !== newTime.getUTCMonth() ||
      oldTime.getUTCDate() !== newTime.getUTCDate();

    if (crossedMidnight) {
      await advanceOrderStatuses(newTime);
    } else {
      await triggerAutoSchedule(newTime);
    }
  } else {
    await advanceOrderStatuses(newTime);
  }
}
