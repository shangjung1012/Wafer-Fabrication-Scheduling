import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { POST } from "@/app/api/schedule/run/route";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import Redis from "ioredis";
import * as scheduleEngine from "@/modules/schedule/engine";
import * as mailTemplate from "@/modules/mail/mail-template";

// Mock requireAuth
vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  CsrfError: class CsrfError extends Error {
    status = 403;
    code = "CSRF_FORBIDDEN";
  },
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

// Mock mail modules so azure SDK is never loaded in tests
vi.mock("@/modules/mail/mail-template", () => ({
  renderAndSend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/mail/templates/kick-out", () => ({
  kickOutTemplate: {
    id: "kick-out-notification",
    name: "mock",
    build: vi.fn(),
  },
}));

describe("POST /api/schedule/run", () => {
  let redisSetMock: Mock;
  let redisDelMock: Mock;

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
    vi.mocked(scheduleEngine.runSchedule).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs(); // 撤銷所有透過 stubEnv 注入的環境變數
    vi.clearAllMocks(); // 順便清空 mock 的呼叫次數，避免跨測試污染
  });

  const createRequest = (body: Record<string, unknown>, headers = {}) => {
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
    expect(scheduleEngine.runSchedule).toHaveBeenCalledWith(
      "Type A",
      undefined,
    );
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

  it("should not allow cron bypass when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());

    const req = createRequest(
      { type: "Type A" },
      { Authorization: "Bearer undefined" },
    );
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(scheduleEngine.runSchedule).not.toHaveBeenCalled();
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
      "EX",
      300,
      "NX",
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
      "EX",
      300,
      "NX",
    );

    // Engine called
    expect(scheduleEngine.runSchedule).toHaveBeenCalledWith(
      "Type A",
      undefined,
    );

    // Released lock
    expect(redisDelMock).toHaveBeenCalledWith("schedule:lock:Type A");
  });

  it("reports auto-send success only when all conflict emails are sent", async () => {
    vi.stubEnv("CONFLICT_EMAIL_AUTO_SEND", "true");
    vi.mocked(scheduleEngine.runSchedule).mockResolvedValueOnce([
      {
        id: "O1",
        name: "Order 1",
        quantity: 10,
        dueDate: "2026-05-20",
        applicantEmail: "sales@example.com",
        applicantUsername: "sales",
        adminEmail: "admin@example.com",
        adminUsername: "admin",
      },
    ]);
    vi.mocked(mailTemplate.renderAndSend).mockResolvedValue(undefined);

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailsSent).toBe(true);
    expect(json.emailFailures).toBe(0);
    expect(mailTemplate.renderAndSend).toHaveBeenCalledTimes(2);
  });

  it("does not report auto-send success when any conflict email fails", async () => {
    vi.stubEnv("CONFLICT_EMAIL_AUTO_SEND", "true");
    vi.mocked(scheduleEngine.runSchedule).mockResolvedValueOnce([
      {
        id: "O1",
        name: "Order 1",
        quantity: 10,
        dueDate: "2026-05-20",
        applicantEmail: "sales@example.com",
        applicantUsername: "sales",
        adminEmail: "admin@example.com",
        adminUsername: "admin",
      },
    ]);
    vi.mocked(mailTemplate.renderAndSend)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("smtp error"));

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.emailsSent).toBe(false);
    expect(json.emailFailures).toBe(1);
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
