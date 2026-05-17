import {
  greedyBestFitStrategy,
  type SchedulingConfig,
} from "@/modules/schedule/strategy";
import {
  prepareSchedulingData,
  applyScheduleTransaction,
} from "@/modules/schedule/core";

export async function runSchedule(
  type: string,
  config: SchedulingConfig,
  currentDate: Date = new Date(),
): Promise<void> {
  const { orders, factories, capacities } = await prepareSchedulingData(
    type,
    config,
  );

  const strategyResult = greedyBestFitStrategy.execute(
    orders,
    factories,
    capacities,
    config,
    currentDate,
  );

  await applyScheduleTransaction(type, config, strategyResult);
}
