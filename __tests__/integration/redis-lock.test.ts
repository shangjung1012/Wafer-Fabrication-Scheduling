import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { POST } from "@/app/api/schedule/run/route";
import Redis from "ioredis";
import { requireAuth } from "@/modules/auth/require-auth";
import * as scheduleEngine from "@/modules/schedule/run";

// Mock the schedule engine so we don't actually hit the DB,
// and we can artificially delay it to guarantee the lock is held.
vi.mock("@/modules/schedule/run", () => ({
  runSchedule: vi.fn().mockImplementation(async () => {
    // Simulate 100ms of work
    await new Promise((r) => setTimeout(r, 100));
  }),
}));

// Mock getTime so the route doesn't pay a DB roundtrip; this test only
// verifies Redis lock fail-fast, not simulation-date resolution.
vi.mock("@/lib/get-time", () => ({
  getTime: vi.fn().mockResolvedValue(new Date()),
}));

// Mock requireAuth to simulate JWT validation for ADMIN users
vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

// We need a real Redis instance for this test to actually verify
// concurrent lock acquisition behavior across asynchronous JS ticks.
describe("POST /api/schedule/run - Concurrency Integration (Redis Required)", () => {
  let redis: Redis;

  beforeAll(async () => {
    if (!process.env.REDIS_URL || process.env.REDIS_URL.includes("dummy")) {
      throw new Error(
        "CRITICAL: REDIS_URL must be a valid real Redis connection string for this test.",
      );
    }

    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 0,
      retryStrategy: () => null, // Fail immediately if connection drops
    });

    try {
      // Force an immediate connection check
      await redis.ping();
    } catch {
      throw new Error(
        "CRITICAL: Redis is not running. This integration test explicitly requires a real Redis instance to prevent race conditions.",
      );
    }

    process.env.CRON_SECRET = "concurrent-test-secret";
  });

  afterAll(async () => {
    if (redis && redis.status === "ready") {
      await redis.del("schedule:lock:ConcurrencyTestType");
      redis.disconnect();
    }
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    // Clear lock before each test
    await redis.del("schedule:lock:ConcurrencyTestType");
    vi.clearAllMocks();

    // Default mock behavior for admin requests
    vi.mocked(requireAuth).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as unknown as Awaited<ReturnType<typeof requireAuth>>);
  });

  // Helper to create a Cron Request
  const createCronRequest = () => {
    return new Request("http://localhost:3000/api/schedule/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CRON_SECRET}`, // Bypass DB auth for this test
      },
      body: JSON.stringify({ type: "ConcurrencyTestType" }),
    });
  };

  // Helper to create a JWT Request
  const createJwtRequest = () => {
    return new Request("http://localhost:3000/api/schedule/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer some-valid-jwt-token`, // Triggers requireAuth
      },
      body: JSON.stringify({ type: "ConcurrencyTestType" }),
    });
  };

  const executeConcurrentTest = async (req1: Request, req2: Request) => {
    const startTime = Date.now();
    const responses = await Promise.all([POST(req1), POST(req2)]);
    const duration = Date.now() - startTime;

    const statuses = responses.map((res) => res.status);

    // One must have succeeded (200), one must have been rejected (409)
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    // Ensure the engine was only triggered once
    expect(scheduleEngine.runSchedule).toHaveBeenCalledTimes(1);

    // Ensure it ran fast (< 250ms), proving fail-fast behavior
    expect(duration).toBeLessThan(250);
  };

  it("should prevent race condition: Cron vs Cron", async () => {
    await executeConcurrentTest(createCronRequest(), createCronRequest());
  });

  it("should prevent race condition: Admin (JWT) vs Admin (JWT)", async () => {
    await executeConcurrentTest(createJwtRequest(), createJwtRequest());
  });

  it("should prevent race condition: Cron vs Admin (JWT)", async () => {
    await executeConcurrentTest(createCronRequest(), createJwtRequest());
  });

  it("should prevent race condition: Admin (JWT) vs Cron", async () => {
    await executeConcurrentTest(createJwtRequest(), createCronRequest());
  });
});
