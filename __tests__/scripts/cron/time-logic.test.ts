import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { triggerAutoSchedule } from "@/modules/schedule/auto-scheduler";
import { findFactoriesWithCapacities } from "@/infra/db/factory-repository";
import {
  FactoryStatus,
  type PrismaClient,
  type SystemState,
} from "@/lib/generated/prisma";
import { handleSimulationTimeAdvance } from "@/modules/schedule/simulation-service";
import { runAutoSchedulerCron, runDailyExecutionCron } from "@/scripts/cron";

// Mock dependencies
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemState: {
      findUnique: vi.fn(),
    },
    factory: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/modules/schedule/daily-execution", () => ({
  advanceOrderStatuses: vi.fn(),
}));

vi.mock("@/modules/schedule/auto-scheduler", () => ({
  triggerAutoSchedule: vi.fn(),
}));

describe("Time Logic and Cron Jobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1. Cron Guard Clause Test", () => {
    it("should immediately return if isSimulationMode is true", async () => {
      vi.mocked(prisma.systemState.findUnique).mockResolvedValue({
        id: "global",
        isSimulationMode: true,
        simulationDate: null,
      } satisfies SystemState);

      await runDailyExecutionCron();
      await runAutoSchedulerCron();

      expect(advanceOrderStatuses).not.toHaveBeenCalled();
      expect(triggerAutoSchedule).not.toHaveBeenCalled();
    });

    it("should execute if isSimulationMode is false and correctly use fake timers", async () => {
      vi.mocked(prisma.systemState.findUnique).mockResolvedValue({
        id: "global",
        isSimulationMode: false,
        simulationDate: null,
      } satisfies SystemState);

      // Set a specific fake time
      const mockNow = new Date("2026-06-03T12:00:00.000Z");
      vi.setSystemTime(mockNow);

      // getTime() returns UTC midnight for the business date
      const expectedBusinessDate = new Date("2026-06-03T00:00:00.000Z");

      await runDailyExecutionCron();
      expect(advanceOrderStatuses).toHaveBeenCalledWith(expectedBusinessDate);

      await runAutoSchedulerCron();
      expect(triggerAutoSchedule).toHaveBeenCalledWith(expectedBusinessDate);
    });
  });

  describe("2. Midnight Crossing Logic Test", () => {
    it("Scenario A: Time is 14:00. Add 2 hours -> 16:00. Assert triggerAutoSchedule is called", async () => {
      const oldTime = new Date("2026-06-03T14:00:00.000Z");
      const newTime = new Date("2026-06-03T16:00:00.000Z");

      await handleSimulationTimeAdvance(oldTime, newTime);

      expect(triggerAutoSchedule).toHaveBeenCalledWith(newTime);
      expect(advanceOrderStatuses).not.toHaveBeenCalled();
    });

    it("Scenario B: Time is 23:00. Add 2 hours -> 01:00 (Next day). Assert advanceOrderStatuses is called", async () => {
      const oldTime = new Date("2026-06-03T23:00:00.000Z");
      const newTime = new Date("2026-06-04T01:00:00.000Z");

      await handleSimulationTimeAdvance(oldTime, newTime);

      expect(advanceOrderStatuses).toHaveBeenCalledWith(newTime);
      expect(triggerAutoSchedule).not.toHaveBeenCalled();
    });
  });

  describe("3. Capacity Date Flooring Test", () => {
    it("should strictly floor the gte date to UTC midnight", async () => {
      const currentDate = new Date("2026-06-03T15:30:00.000Z");
      const expectedMidnight = new Date("2026-06-03T00:00:00.000Z");

      await findFactoriesWithCapacities(
        prisma as unknown as PrismaClient,
        "A",
        currentDate,
      );

      expect(prisma.factory.findMany).toHaveBeenCalledWith({
        where: {
          productionType: "A",
          status: FactoryStatus.ACTIVE,
        },
        include: {
          dailyCapacities: {
            where: {
              date: {
                gte: expectedMidnight,
              },
            },
          },
        },
      });
    });
  });
});
