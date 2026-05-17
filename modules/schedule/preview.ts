import {
  greedyBestFitStrategy,
  type SchedulingConfig,
  type StrategyResult,
} from "@/modules/schedule/strategy";
import { prepareSchedulingData } from "@/modules/schedule/core";

export async function previewSchedule(
  type: string,
  config: SchedulingConfig,
  currentDate: Date = new Date(),
): Promise<StrategyResult> {
  const { orders, factories, capacities } = await prepareSchedulingData(
    type,
    config,
  );

  return greedyBestFitStrategy.execute(
    orders,
    factories,
    capacities,
    config,
    currentDate,
  );
}
