import { withScheduleLock } from "@/infra/redis/schedule-store";
import {
  getAffectedOrderTypes,
  executeDailyStateAdvancement,
} from "@/infra/db/daily-execution-repository";

export async function advanceOrderStatuses(currentDate: Date) {
  // Fetch types of orders that are going to be affected to acquire lock
  const types = await getAffectedOrderTypes(currentDate);

  if (types.length === 0) return;

  return withScheduleLock(types, async () => {
    await executeDailyStateAdvancement(currentDate);
  });
}
