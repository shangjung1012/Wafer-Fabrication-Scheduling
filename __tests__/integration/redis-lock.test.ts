import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { withScheduleLock } from "@/infra/redis/schedule-store";
import { getRedis } from "@/lib/redis";

describe("Redis Lock Integration", () => {
  beforeAll(async () => {
    const redis = getRedis();
    await redis.ping();
  });

  beforeEach(async () => {
    const redis = getRedis();
    await redis.del("schedule:lock:A", "schedule:lock:B");
  });

  afterAll(async () => {
    const redis = getRedis();
    await redis.quit();
  });

  it("should prevent concurrent execution for the same type", async () => {
    let executionCount = 0;
    const task = async () => {
      return withScheduleLock("A", async () => {
        await new Promise((r) => setTimeout(r, 100));
        executionCount++;
      });
    };

    const results = await Promise.allSettled([task(), task()]);
    expect(executionCount).toBe(1);
    expect(results.some((r) => r.status === "rejected")).toBe(true);
  });

  it("should allow concurrent execution for different types", async () => {
    let executionCount = 0;
    const task = async (type: string) => {
      return withScheduleLock(type, async () => {
        await new Promise((r) => setTimeout(r, 100));
        executionCount++;
      });
    };

    const results = await Promise.allSettled([task("A"), task("B")]);
    expect(executionCount).toBe(2);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
});
