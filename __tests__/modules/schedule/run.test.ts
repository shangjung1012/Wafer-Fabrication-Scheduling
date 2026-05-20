import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSchedule } from "@/modules/schedule/run";
import {
  greedyBestFitStrategy,
  type StrategyResult,
  type SchedulingConfig,
} from "@/modules/schedule/strategy";
import * as core from "@/modules/schedule/core";

vi.mock("@/modules/schedule/core", () => ({
  prepareSchedulingData: vi.fn(),
  _applyScheduleTransaction: vi.fn(),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  withScheduleLock: vi.fn(async (type, cb) => {
    return cb();
  }),
}));

vi.mock("@/modules/schedule/strategy", () => ({
  greedyBestFitStrategy: {
    execute: vi.fn(),
  },
}));

describe("Schedule Engine - Run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch data, run strategy, and execute atomic transaction", async () => {
    const mockData = {
      orders: [
        {
          id: "O1",
          status: "APPROVED",
          dueDate: new Date(),
          quantity: 100,
          createdAt: new Date(),
        },
      ],
      factories: [{ id: "F1", maxCapacity: 100 }],
      capacities: [
        {
          id: "C1",
          factoryId: "F1",
          date: new Date(),
          maxCapacity: 100,
          curCapacity: 100,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof core.prepareSchedulingData>>;
    vi.mocked(core.prepareSchedulingData).mockResolvedValue(mockData);

    const mockStrategyResult = {
      processedOrders: [],
      newAssignments: [],
      updatedCapacities: [],
      newCapacities: [],
    } as unknown as StrategyResult;
    vi.mocked(greedyBestFitStrategy.execute).mockReturnValue(
      mockStrategyResult,
    );

    const dummyConfig: SchedulingConfig = {
      startDate: new Date(),
      frozenDays: 0,
      productionDays: 1,
      bufferDays: 0,
      reschedulePolicy: "GLOBAL_OPTIMIZE",
      algorithm: "GREEDY_BEST_FIT",
      splittable: true,
    };
    const currentDate = new Date();
    await runSchedule("Type A", dummyConfig, currentDate);

    expect(core.prepareSchedulingData).toHaveBeenCalledWith(
      "Type A",
      dummyConfig,
      currentDate,
    );
    expect(greedyBestFitStrategy.execute).toHaveBeenCalledWith(
      mockData.orders,
      mockData.factories,
      mockData.capacities,
      dummyConfig,
      currentDate,
    );
    expect(core._applyScheduleTransaction).toHaveBeenCalledWith(
      "Type A",
      dummyConfig,
      mockStrategyResult,
      "system-user",
    );
  });
});
