import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/schedule/run/route";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import Redis from "ioredis";
import * as scheduleEngine from "@/modules/schedule/engine";

// Mock requireAuth
vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    status = 401;
    code = "UNAUTHORIZED";
  },
}));

// Mock ioredis
vi.mock("ioredis", () => {
  const RedisMock = vi.fn();
  RedisMock.prototype.set = vi.fn();
  RedisMock.prototype.del = vi.fn();
  return { default: RedisMock };
});

// Mock schedule engine
vi.mock("@/modules/schedule/engine", () => ({
  runSchedule: vi.fn(),
}));

describe("POST /api/schedule/run", () => {
  let redisSetMock: any;
  let redisDelMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Redis mock instance methods
    const redisInstance = new Redis();
    redisSetMock = vi.mocked(redisInstance.set);
    redisDelMock = vi.mocked(redisInstance.del);

    // Default: successfully acquire lock
    redisSetMock.mockResolvedValue("OK");

    // Default: auth success
    vi.mocked(requireAuth).mockResolvedValue({
      requestId: "test-req",
      user: { id: "user-1", role: "SUPERADMIN" },
    });

    // Default: engine success
    vi.mocked(scheduleEngine.runSchedule).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs(); // 撤銷所有透過 stubEnv 注入的環境變數
    vi.clearAllMocks(); // 順便清空 mock 的呼叫次數，避免跨測試污染
  });

  const createRequest = (body: any, headers = {}) => {
    return new Request("http://localhost:3000/api/schedule/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  };

  it("should return 401 if not authenticated and not a valid cron", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("should return 403 if user is not SUPERADMIN or ADMIN", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce({
      requestId: "test-req",
      user: { id: "user-1", role: "SALES" },
    });

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("FORBIDDEN");
  });

  it("should allow execution if valid CRON_SECRET is provided", async () => {
    // 動態且安全地注入環境變數
    vi.stubEnv("CRON_SECRET", "super-secret-cron-key");
  
    // Mock requireAuth to reject, ensuring we bypass it entirely
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());

    const req = createRequest(
      { type: "Type A" },
      { Authorization: "Bearer super-secret-cron-key" },
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(scheduleEngine.runSchedule).toHaveBeenCalledWith("Type A");
  });

  it("should reject execution if invalid CRON_SECRET is provided", async () => {
    vi.stubEnv("CRON_SECRET", "super-secret-cron-key");
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());

    const req = createRequest(
      { type: "Type A" },
      { Authorization: "Bearer wrong-secret" },
    );
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it("should return 400 if body is invalid", async () => {
    const req = createRequest({}); // Missing 'type'
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("should return 409 if redis lock cannot be acquired", async () => {
    // Return null simulating lock already taken
    redisSetMock.mockResolvedValueOnce(null);

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("CONFLICT");

    expect(redisSetMock).toHaveBeenCalledWith(
      "schedule:lock:Type A",
      "locked",
      "NX",
      "EX",
      300,
    );
    // Should not call runSchedule if locked
    expect(scheduleEngine.runSchedule).not.toHaveBeenCalled();
    // Should NOT release lock if we didn't acquire it
    expect(redisDelMock).not.toHaveBeenCalled();
  });

  it("should run schedule and release lock on success", async () => {
    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe("Schedule run successfully");

    // Acquired lock
    expect(redisSetMock).toHaveBeenCalledWith(
      "schedule:lock:Type A",
      "locked",
      "NX",
      "EX",
      300,
    );

    // Engine called
    expect(scheduleEngine.runSchedule).toHaveBeenCalledWith("Type A");

    // Released lock
    expect(redisDelMock).toHaveBeenCalledWith("schedule:lock:Type A");
  });

  it("should release lock even if engine throws an error", async () => {
    vi.mocked(scheduleEngine.runSchedule).mockRejectedValueOnce(
      new Error("Engine failed"),
    );

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(500);

    // Lock was released
    expect(redisDelMock).toHaveBeenCalledWith("schedule:lock:Type A");
  });
});
