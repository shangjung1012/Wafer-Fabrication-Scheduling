import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedis: vi.fn(),
}));

describe("GET /api/system/health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns ok when database and Redis are reachable", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { getRedis } = await import("@/lib/redis");
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ok: 1 }]);
    vi.mocked(getRedis).mockReturnValue({
      ping: vi.fn().mockResolvedValue("PONG"),
    } as never);

    const { GET } = await import("@/app/api/system/health/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.dependencies.database.status).toBe("ok");
    expect(body.dependencies.redis.status).toBe("ok");
  });

  it("returns 503 with dependency details when a dependency is unavailable", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { getRedis } = await import("@/lib/redis");
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("db down"));
    vi.mocked(getRedis).mockReturnValue({
      ping: vi.fn().mockResolvedValue("PONG"),
    } as never);

    const { GET } = await import("@/app/api/system/health/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.dependencies.database.status).toBe("error");
    expect(body.dependencies.redis.status).toBe("ok");
  });
});
