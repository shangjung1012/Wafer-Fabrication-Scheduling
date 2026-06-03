import { afterEach, describe, expect, it, vi } from "vitest";

const redisMocks = vi.hoisted(() => ({
  redisCtor: vi.fn(),
  clusterCtor: vi.fn(),
  on: vi.fn(),
}));

vi.mock("ioredis", () => {
  class Redis {
    on = redisMocks.on;
    constructor(url: string) {
      redisMocks.redisCtor(url);
    }
  }

  class Cluster {
    on = redisMocks.on;
    constructor(nodes: unknown, options: unknown) {
      redisMocks.clusterCtor(nodes, options);
    }
  }

  return { default: Redis, Cluster };
});

describe("getRedis", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a single-node Redis client from REDIS_URL", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");

    const { getRedis } = await import("@/lib/redis");
    const first = getRedis();
    const second = getRedis();

    expect(first).toBe(second);
    expect(redisMocks.redisCtor).toHaveBeenCalledTimes(1);
    expect(redisMocks.redisCtor).toHaveBeenCalledWith("redis://localhost:6379");
    expect(redisMocks.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("creates a cluster client with decoded credentials and TLS options", async () => {
    vi.stubEnv("REDIS_CLUSTER", "true");
    vi.stubEnv(
      "REDIS_CLUSTER_NODES",
      "rediss://user%40name:p%40ss@cache-a.example:6380,redis://cache-b.example",
    );

    const { getRedis } = await import("@/lib/redis");
    getRedis();

    expect(redisMocks.clusterCtor).toHaveBeenCalledWith(
      [
        { host: "cache-a.example", port: 6380 },
        { host: "cache-b.example", port: 6379 },
      ],
      {
        redisOptions: {
          username: "user@name",
          password: "p@ss",
          tls: { servername: "cache-a.example" },
        },
      },
    );
  });

  it("throws when no Redis URL is configured", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("REDIS_CLUSTER_NODES", "");

    const { getRedis } = await import("@/lib/redis");

    expect(() => getRedis()).toThrow("REDIS_URL environment variable");
  });
});
