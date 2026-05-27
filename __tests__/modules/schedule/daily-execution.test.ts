import { describe, it, expect, vi, beforeEach } from "vitest";
import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { withScheduleLock } from "@/infra/redis/schedule-store";
import {
  getAffectedOrderTypes,
  executeDailyStateAdvancement,
} from "@/infra/db/daily-execution-repository";

vi.mock("@/infra/db/daily-execution-repository", () => ({
  getAffectedOrderTypes: vi.fn(),
  executeDailyStateAdvancement: vi.fn(),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  withScheduleLock: vi.fn(async (types, cb) => cb()),
}));

describe("Daily Execution Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do nothing if no assignments are affected", async () => {
    vi.mocked(getAffectedOrderTypes).mockResolvedValue([]);

    await advanceOrderStatuses(new Date());

    expect(getAffectedOrderTypes).toHaveBeenCalled();
    expect(withScheduleLock).not.toHaveBeenCalled();
    expect(executeDailyStateAdvancement).not.toHaveBeenCalled();
  });

  it("should acquire lock and advance state if affected orders exist", async () => {
    const currentDate = new Date();

    vi.mocked(getAffectedOrderTypes).mockResolvedValue(["Type A", "Type B"]);

    await advanceOrderStatuses(currentDate);

    expect(getAffectedOrderTypes).toHaveBeenCalledWith(currentDate);
    expect(withScheduleLock).toHaveBeenCalledWith(
      ["Type A", "Type B"],
      expect.any(Function),
    );
    expect(executeDailyStateAdvancement).toHaveBeenCalledWith(
      currentDate,
      undefined,
    );
  });
});
