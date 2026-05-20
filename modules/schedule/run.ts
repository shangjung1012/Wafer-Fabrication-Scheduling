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
): Promise<void> {
  return withScheduleLock(type, async () => {
    const actualDate = currentDate ?? (await getTime());

    const { orders, factories, capacities } = await prepareSchedulingData(
      type,
      config,
      actualDate,
    );

    const strategyResult = greedyBestFitStrategy.execute(
      orders,
      factories,
      capacities,
      config,
      actualDate,
    );

    await _applyScheduleTransaction(type, config, strategyResult, operatorId);
  });
}
