import {
  greedyBestFitStrategy,
  type SchedulingConfig,
} from "@/modules/schedule/strategy";
import {
  prepareSchedulingData,
  _applyScheduleTransaction,
} from "@/modules/schedule/core";
import { withScheduleLock } from "@/infra/redis/schedule-store";

import { getTime } from "@/lib/get-time";

export async function runSchedule(
  type: string,
  config: SchedulingConfig,
  currentDate?: Date,
  operatorId: string = "system-user",
): Promise<{ failedIds: string[] }> {
  return withScheduleLock(type, async () => {
    const actualDate = currentDate ?? (await getTime());

    const { orders, factories, capacities, dbCapacities } =
      await prepareSchedulingData(type, config, actualDate, true);

    const strategyResult = greedyBestFitStrategy.execute(
      orders,
      factories,
      capacities,
      config,
      actualDate,
      dbCapacities,
    );

    return _applyScheduleTransaction(type, config, strategyResult, operatorId);
  });
}
