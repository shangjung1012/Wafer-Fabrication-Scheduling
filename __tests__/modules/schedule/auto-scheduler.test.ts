import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findPendingOrderTypes,
  findUserByUsername,
  getAutoSchedulerConfigByType,
  runScheduleWithIssues,
} = vi.hoisted(() => ({
  findPendingOrderTypes: vi.fn(),
  findUserByUsername: vi.fn(),
  getAutoSchedulerConfigByType: vi.fn(),
  runScheduleWithIssues: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/infra/db/order-repository", () => ({ findPendingOrderTypes }));
vi.mock("@/infra/db/user-repository", () => ({ findUserByUsername }));
vi.mock("@/infra/db/auto-scheduler-config-repository", () => ({
  getAutoSchedulerConfigByType,
}));
vi.mock("@/modules/order/schedule-orchestrator", () => ({
  runScheduleWithIssues,
}));

const BASE_CONFIG = {
  isOperating: true,
  frozenDays: 1,
  productionDays: 5,
  bufferDays: 2,
  algorithm: "GREEDY_BEST_FIT",
  splittable: false,
};

describe("triggerAutoSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runScheduleWithIssues.mockResolvedValue(undefined);
  });

  it("returns early when there are no pending order types", async () => {
    findPendingOrderTypes.mockResolvedValue([]);
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    await triggerAutoSchedule(new Date("2026-06-03T00:00:00.000Z"));
    expect(findUserByUsername).not.toHaveBeenCalled();
  });

  it("returns early when the system user is not found", async () => {
    findPendingOrderTypes.mockResolvedValue(["A"]);
    findUserByUsername.mockResolvedValue(null);
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    await triggerAutoSchedule(new Date("2026-06-03T00:00:00.000Z"));
    expect(getAutoSchedulerConfigByType).not.toHaveBeenCalled();
  });

  it("skips a type when config is missing", async () => {
    findPendingOrderTypes.mockResolvedValue(["A"]);
    findUserByUsername.mockResolvedValue({ id: "sys-1" });
    getAutoSchedulerConfigByType.mockResolvedValue(null);
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    await triggerAutoSchedule(new Date("2026-06-03T00:00:00.000Z"));
    expect(runScheduleWithIssues).not.toHaveBeenCalled();
  });

  it("skips a type when config.isOperating is false", async () => {
    findPendingOrderTypes.mockResolvedValue(["A"]);
    findUserByUsername.mockResolvedValue({ id: "sys-1" });
    getAutoSchedulerConfigByType.mockResolvedValue({
      ...BASE_CONFIG,
      isOperating: false,
    });
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    await triggerAutoSchedule(new Date("2026-06-03T00:00:00.000Z"));
    expect(runScheduleWithIssues).not.toHaveBeenCalled();
  });

  it("runs the schedule when config is active", async () => {
    findPendingOrderTypes.mockResolvedValue(["A"]);
    findUserByUsername.mockResolvedValue({ id: "sys-1" });
    getAutoSchedulerConfigByType.mockResolvedValue(BASE_CONFIG);
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    const currentDate = new Date("2026-06-03T00:00:00.000Z");
    await triggerAutoSchedule(currentDate);
    expect(runScheduleWithIssues).toHaveBeenCalledWith(
      expect.objectContaining({ type: "A", operatorId: "sys-1" }),
    );
  });

  it("swallows 'already running' errors and continues to the next type", async () => {
    findPendingOrderTypes.mockResolvedValue(["A", "B"]);
    findUserByUsername.mockResolvedValue({ id: "sys-1" });
    getAutoSchedulerConfigByType.mockResolvedValue(BASE_CONFIG);
    runScheduleWithIssues
      .mockRejectedValueOnce(new Error("schedule already running"))
      .mockResolvedValueOnce(undefined);
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    await expect(
      triggerAutoSchedule(new Date("2026-06-03T00:00:00.000Z")),
    ).resolves.toBeUndefined();
    expect(runScheduleWithIssues).toHaveBeenCalledTimes(2);
  });

  it("logs and continues when a non-lock error occurs", async () => {
    findPendingOrderTypes.mockResolvedValue(["A", "B"]);
    findUserByUsername.mockResolvedValue({ id: "sys-1" });
    getAutoSchedulerConfigByType.mockResolvedValue(BASE_CONFIG);
    runScheduleWithIssues
      .mockRejectedValueOnce(new Error("unexpected DB failure"))
      .mockResolvedValueOnce(undefined);
    const { triggerAutoSchedule } =
      await import("@/modules/schedule/auto-scheduler");
    await expect(
      triggerAutoSchedule(new Date("2026-06-03T00:00:00.000Z")),
    ).resolves.toBeUndefined();
    expect(runScheduleWithIssues).toHaveBeenCalledTimes(2);
  });
});
