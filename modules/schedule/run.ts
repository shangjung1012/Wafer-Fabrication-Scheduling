import {
  greedyBestFitStrategy,
  type SchedulingConfig,
} from "@/modules/schedule/strategy";
import {
  prepareSchedulingData,
  applyScheduleTransaction,
} from "@/modules/schedule/core";

import { getTime } from "@/lib/get-time";

export async function runSchedule(
  type: string,
  config: SchedulingConfig,
  currentDate?: Date,
): Promise<void> {
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

  await applyScheduleTransaction(type, config, strategyResult);
}
