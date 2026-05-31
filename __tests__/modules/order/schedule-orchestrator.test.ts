import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as scheduleCore from "@/modules/schedule/core";
import * as scheduleRun from "@/modules/schedule/run";
import {
  applyScheduleTransactionWithIssues,
  runScheduleWithIssues,
} from "@/modules/order/schedule-orchestrator";
import type { SchedulingConfig } from "@/modules/schedule/strategy";
import type { StrategyResult } from "@/modules/schedule/strategy";

vi.mock("@/modules/schedule/run", () => ({
  runSchedule: vi.fn(),
}));

vi.mock("@/modules/schedule/core", () => ({
  applyScheduleTransaction: vi.fn(),
}));

const config: SchedulingConfig = {
  startDate: new Date("2026-06-01T00:00:00.000Z"),
  reschedulePolicy: "GAP_FILLING",
  frozenDays: 0,
  bufferDays: 0,
  productionDays: 5,
  algorithm: "GREEDY_BEST_FIT",
  splittable: true,
};

async function flushQueuedEmailPromises() {
  await Promise.resolve();
}

describe("schedule orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the scheduler and dispatches returned emails after responding", async () => {
    const email = vi.fn().mockResolvedValue(undefined);
    const queueSpy = vi.spyOn(globalThis, "queueMicrotask");
    const currentDate = new Date("2026-06-01T00:00:00.000Z");
    vi.mocked(scheduleRun.runSchedule).mockResolvedValue({
      failedIds: ["order-1"],
      emailsToDispatch: [email],
    });

    const result = await runScheduleWithIssues({
      type: "A",
      config,
      currentDate,
      operatorId: "admin-1",
    });

    expect(result).toEqual({ failedIds: ["order-1"] });
    expect(scheduleRun.runSchedule).toHaveBeenCalledWith(
      "A",
      config,
      currentDate,
      "admin-1",
    );

    expect(queueSpy).toHaveBeenCalledOnce();
    await flushQueuedEmailPromises();
    expect(email).toHaveBeenCalledOnce();
  });

  it("does not queue email work when the scheduler returns no dispatchers", async () => {
    const queueSpy = vi.spyOn(globalThis, "queueMicrotask");
    vi.mocked(scheduleRun.runSchedule).mockResolvedValue({
      failedIds: [],
      emailsToDispatch: [],
    });

    const result = await runScheduleWithIssues({
      type: "B",
      config,
      currentDate: new Date("2026-06-02T00:00:00.000Z"),
      operatorId: "admin-2",
    });

    expect(result).toEqual({ failedIds: [] });
    expect(queueSpy).not.toHaveBeenCalled();
  });

  it("applies a preview schedule and dispatches returned emails after responding", async () => {
    const email = vi.fn().mockResolvedValue(undefined);
    const queueSpy = vi.spyOn(globalThis, "queueMicrotask");
    const strategyResult = {
      assignments: [],
      failedOrders: [],
    } as unknown as StrategyResult;
    vi.mocked(scheduleCore.applyScheduleTransaction).mockResolvedValue({
      failedIds: ["order-9"],
      emailsToDispatch: [email],
    });

    const result = await applyScheduleTransactionWithIssues({
      type: "C",
      config,
      result: strategyResult,
      operatorId: "admin-3",
      runAt: new Date("2026-06-03T00:00:00.000Z"),
      expectedVersion: 7,
      previewId: "preview-1",
    });

    expect(result).toEqual({ failedIds: ["order-9"] });
    expect(scheduleCore.applyScheduleTransaction).toHaveBeenCalledWith(
      "C",
      config,
      strategyResult,
      "admin-3",
      7,
      "preview-1",
    );

    expect(queueSpy).toHaveBeenCalledOnce();
    await flushQueuedEmailPromises();
    expect(email).toHaveBeenCalledOnce();
  });
});
