import { SchedulingConfig } from "@/modules/schedule/strategy";

export function calculateOrderDeadline(
  dueDate: Date,
  config: Pick<SchedulingConfig, "bufferDays" | "productionDays">,
): Date {
  const windowEnd = new Date(
    Date.UTC(
      dueDate.getUTCFullYear(),
      dueDate.getUTCMonth(),
      dueDate.getUTCDate(),
    ),
  );
  windowEnd.setUTCDate(
    windowEnd.getUTCDate() - config.bufferDays - config.productionDays,
  );
  return windowEnd;
}

export function calculateMinimumStartDate(
  currentDate: Date,
  frozenDays: number,
): Date {
  return new Date(
    Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate() + 1 + frozenDays,
    ),
  );
}
