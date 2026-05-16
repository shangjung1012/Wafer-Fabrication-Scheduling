export interface SchedulingConfig {
  startDate: Date; // The absolute start of the rolling horizon
  endDate?: Date; // The absolute end of the rolling horizon (optional)
  frozenDays: number;
  productionDays: number;
  bufferDays: number;
  reschedulePolicy: "GLOBAL_OPTIMIZE" | "PRIORITY_RETAIN" | "GAP_FILLING";
  algorithm: "GREEDY_BEST_FIT";
  splittable: boolean; // Global flag for this scheduling run
}
