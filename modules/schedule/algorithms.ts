import {
  greedyBestFitStrategy,
  type SchedulingCapacityInput,
  type SchedulingFactoryInput,
  type SchedulingOrderInput,
  type StrategyResult,
} from "@/modules/schedule/strategy";

export type SchedulingAlgorithmId =
  | "greedy-best-fit"
  | "earliest-due-date"
  | "balanced-load";

export type SchedulingAlgorithm = {
  id: SchedulingAlgorithmId;
  label: string;
  description: string;
  run: (
    orders: SchedulingOrderInput[],
    factories: SchedulingFactoryInput[],
    capacities: SchedulingCapacityInput[],
    currentDate: Date,
  ) => StrategyResult;
};

export const SCHEDULING_ALGORITHMS: Record<
  SchedulingAlgorithmId,
  SchedulingAlgorithm
> = {
  "greedy-best-fit": {
    id: "greedy-best-fit",
    label: "Greedy Best-Fit",
    description:
      "Sort by due date, then assign to the factory with the most remaining capacity per day.",
    run: greedyBestFitStrategy,
  },
  "earliest-due-date": {
    id: "earliest-due-date",
    label: "Earliest Due Date (preview)",
    description:
      "Stub — pure due-date order. Falls back to greedy best-fit until a dedicated implementation lands.",
    run: greedyBestFitStrategy,
  },
  "balanced-load": {
    id: "balanced-load",
    label: "Balanced Load (preview)",
    description:
      "Stub — would distribute orders evenly across factories. Falls back to greedy best-fit for now.",
    run: greedyBestFitStrategy,
  },
};

export const DEFAULT_ALGORITHM: SchedulingAlgorithmId = "greedy-best-fit";

export function resolveAlgorithm(id: string | undefined): SchedulingAlgorithm {
  if (!id) return SCHEDULING_ALGORITHMS[DEFAULT_ALGORITHM];
  const algo = SCHEDULING_ALGORITHMS[id as SchedulingAlgorithmId];
  return algo ?? SCHEDULING_ALGORITHMS[DEFAULT_ALGORITHM];
}

export function listAlgorithms() {
  return Object.values(SCHEDULING_ALGORITHMS).map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
  }));
}
