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
    windowEnd.getUTCDate() - config.bufferDays - (config.productionDays - 1),
  );
  return windowEnd;
}
