export const DEFAULT_DAILY_CAPACITY = 10000;
export const STANDARD_PRODUCTION_TYPES = ["A", "B", "C"] as const;

export type StandardProductionType = (typeof STANDARD_PRODUCTION_TYPES)[number];
