import { withScheduleLock } from "@/infra/redis/schedule-store";
import {
  getAffectedOrderTypes,
  executeDailyStateAdvancement,
} from "@/infra/db/daily-execution-repository";
import { upsertSystemState } from "@/infra/db/system-state-repository";
import { prisma } from "@/lib/prisma";

export async function advanceOrderStatuses(
  currentDate: Date,
  patch?: { isSimulationMode?: boolean; simulationDate?: Date | null },
) {
  // Fetch types of orders that are going to be affected to acquire lock
  const types = await getAffectedOrderTypes(currentDate);

  if (types.length === 0) {
    if (patch) {
      await upsertSystemState(prisma, patch);
    }
    return;
  }

  return withScheduleLock(types, async () => {
    await executeDailyStateAdvancement(currentDate, patch);
  });
}
