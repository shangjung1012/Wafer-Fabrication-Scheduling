import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    systemState: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));

describe("getTime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.BUSINESS_TIMEZONE_OFFSET;
  });

  it("returns simulation date as UTC midnight when simulation mode is active", async () => {
    prisma.systemState.findUnique.mockResolvedValue({
      isSimulationMode: true,
      simulationDate: new Date("2026-05-15T12:34:56.000Z"),
    });

    const { getTime } = await import("@/lib/get-time");
    const result = await getTime();

    expect(result.toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });

  it("returns current UTC business date when not in simulation mode", async () => {
    prisma.systemState.findUnique.mockResolvedValue({
      isSimulationMode: false,
      simulationDate: null,
    });
    process.env.BUSINESS_TIMEZONE_OFFSET = "0";

    // Fix the system clock so the test is deterministic
    const fixedNow = new Date("2026-06-03T10:30:00.000Z");
    vi.setSystemTime(fixedNow);

    const { getTime } = await import("@/lib/get-time");
    const result = await getTime();

    expect(result.toISOString()).toBe("2026-06-03T00:00:00.000Z");

    vi.useRealTimers();
  });

  it("applies BUSINESS_TIMEZONE_OFFSET when deriving local business date", async () => {
    prisma.systemState.findUnique.mockResolvedValue(null);
    process.env.BUSINESS_TIMEZONE_OFFSET = "8"; // UTC+8

    // 2026-06-03T22:00:00 UTC  → local business date is 2026-06-04 in UTC+8
    vi.setSystemTime(new Date("2026-06-03T22:00:00.000Z"));

    const { getTime } = await import("@/lib/get-time");
    const result = await getTime();

    expect(result.toISOString()).toBe("2026-06-04T00:00:00.000Z");

    vi.useRealTimers();
  });

  it("returns null state as real-time mode with UTC+0", async () => {
    prisma.systemState.findUnique.mockResolvedValue(null);
    process.env.BUSINESS_TIMEZONE_OFFSET = "0";

    vi.setSystemTime(new Date("2026-06-03T05:00:00.000Z"));

    const { getTime } = await import("@/lib/get-time");
    const result = await getTime();

    expect(result.toISOString()).toBe("2026-06-03T00:00:00.000Z");

    vi.useRealTimers();
  });
});
