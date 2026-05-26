import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateOrderDeadline,
  calculateMinimumStartDate,
} from "@/modules/schedule/validation-utils";
import { SchedulingConfig } from "@/modules/schedule/strategy";

describe("validation-utils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("calculateOrderDeadline", () => {
    it("strictly bounds the latest possible productionDate (windowEnd)", () => {
      // 1. Setup mock dates and configuration
      const currentDate = new Date("2026-05-01T00:00:00.000Z");
      vi.setSystemTime(currentDate);

      const dueDate = new Date("2026-05-15T00:00:00.000Z");

      const config: Pick<SchedulingConfig, "bufferDays" | "productionDays"> = {
        bufferDays: 2,
        productionDays: 3,
      };

      // 2. Call actual engine function
      const windowEnd = calculateOrderDeadline(dueDate, config);

      // 3. Mathematical boundary: Latest possible productionDate (windowEnd) = dueDate - bufferDays - productionDays
      const expectedWindowEnd = new Date(
        Date.UTC(
          dueDate.getUTCFullYear(),
          dueDate.getUTCMonth(),
          dueDate.getUTCDate() - config.bufferDays - config.productionDays,
        ),
      );

      // Assert it explicitly
      expect(windowEnd.getTime()).toBe(expectedWindowEnd.getTime());
      expect(windowEnd.toISOString()).toBe("2026-05-10T00:00:00.000Z");
    });
  });

  describe("calculateMinimumStartDate", () => {
    it("strictly bounds the earliest possible productionDate (windowStart)", () => {
      // 1. Setup mock dates and configuration
      const currentDate = new Date("2026-05-01T00:00:00.000Z");
      vi.setSystemTime(currentDate);

      const frozenDays = 4;

      // 2. Call actual engine function
      const windowStart = calculateMinimumStartDate(currentDate, frozenDays);

      // 3. Mathematical boundary: Earliest possible productionDate = currentDate + 1 + frozenDays
      const expectedWindowStart = new Date(
        Date.UTC(
          currentDate.getUTCFullYear(),
          currentDate.getUTCMonth(),
          currentDate.getUTCDate() + 1 + frozenDays,
        ),
      );

      // Assert it explicitly
      expect(windowStart.getTime()).toBe(expectedWindowStart.getTime());
      expect(windowStart.toISOString()).toBe("2026-05-06T00:00:00.000Z");
    });
  });
});
