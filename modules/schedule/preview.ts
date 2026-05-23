import {
  greedyBestFitStrategy,
  type SchedulingConfig,
  type StrategyResult,
} from "@/modules/schedule/strategy";
import { prepareSchedulingData } from "@/modules/schedule/core";

import { getTime } from "@/lib/get-time";

export async function previewSchedule(
  type: string,
  config: SchedulingConfig,
  currentDate?: Date,
): Promise<StrategyResult> {
  const actualDate = currentDate ?? (await getTime());

  const { orders, factories, capacities, dbCapacities } =
    await prepareSchedulingData(type, config, actualDate);

  return greedyBestFitStrategy.execute(
    orders,
    factories,
    capacities,
    config,
    actualDate,
    dbCapacities,
  );
}
