import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/schedule/apply/route";
import * as auth from "@/modules/auth/require-auth";
import * as scheduleCore from "@/modules/schedule/core";
import * as scheduleStore from "@/infra/redis/schedule-store";
import { getRedis } from "@/lib/redis";

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  CsrfError: class CsrfError extends Error {
    code = "CSRF_ERROR";
    status = 403;
  },
}));

vi.mock("@/modules/schedule/core", () => ({
  applyScheduleTransaction: vi.fn(),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  getPreview: vi.fn(),
  getScheduleVersion: vi.fn(),
  incrementScheduleVersion: vi.fn(),
  deletePreview: vi.fn(),
}));

vi.mock("@/lib/redis", () => {
  const mockRedisClient = {
    set: vi.fn(),
    del: vi.fn(),
  };
  return {
    getRedis: vi.fn(() => mockRedisClient),
  };
});

describe("POST /api/schedule/apply", () => {
  let mockRedis: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = getRedis() as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;

    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
  });

  const createRequest = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/schedule/apply", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("should return 404 if preview not found", async () => {
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(null);

    const res = await POST(createRequest({ previewId: "missing-123" }));
    expect(res.status).toBe(404);
  });

  it("should return 409 if unable to acquire lock", async () => {
    vi.mocked(scheduleStore.getPreview).mockResolvedValue({
      type: "Type A",
      version: 1,
      config: {},
      result: {},
    });
    mockRedis.set.mockResolvedValue(null); // Lock acquisition fails

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.message).toMatch(/A scheduling process is already running/);
  });

  it("should return 409 if version mismatched and release lock", async () => {
    vi.mocked(scheduleStore.getPreview).mockResolvedValue({
      type: "Type A",
      version: 1,
      config: {},
      result: {},
    });
    mockRedis.set.mockResolvedValue("OK"); // Lock acquired
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(2); // Mismatched version

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.message).toMatch(/Schedule environment has changed/);

    expect(mockRedis.del).toHaveBeenCalledWith("schedule:lock:Type A");
  });

  it("should apply schedule, increment version, delete preview, and release lock", async () => {
    const payload = {
      type: "Type A",
      version: 1,
      config: { splittable: true },
      result: { processedOrders: [] },
    };
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(payload);
    mockRedis.set.mockResolvedValue("OK");
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(200);

    expect(scheduleCore.applyScheduleTransaction).toHaveBeenCalledWith(
      payload.type,
      payload.config,
      payload.result,
    );
    expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith(
      "Type A",
    );
    expect(scheduleStore.deletePreview).toHaveBeenCalledWith("valid-123");
    expect(mockRedis.del).toHaveBeenCalledWith("schedule:lock:Type A");
  });
});
