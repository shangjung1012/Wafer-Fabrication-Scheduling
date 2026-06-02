import { describe, expect, it } from "vitest";

import { isBeforeDateOnly, toUtcDateOnly } from "@/lib/date-utils";

describe("date utils", () => {
  it("normalizes dates to UTC midnight", () => {
    const value = toUtcDateOnly(new Date("2026-06-03T15:45:30.000Z"));

    expect(value.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });

  it("compares dates by UTC date only", () => {
    expect(
      isBeforeDateOnly(
        new Date("2026-06-02T23:59:59.000Z"),
        new Date("2026-06-03T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isBeforeDateOnly(
        new Date("2026-06-03T00:00:00.000Z"),
        new Date("2026-06-03T23:59:59.000Z"),
      ),
    ).toBe(false);
  });
});
