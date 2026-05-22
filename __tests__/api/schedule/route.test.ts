import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/schedule/run/route";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import * as scheduleEngine from "@/modules/schedule/run";
import * as conflictIssueService from "@/modules/order/conflict-issue-service";
import * as getTimeModule from "@/lib/get-time";

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

vi.mock("@/modules/schedule/run", () => ({
  runSchedule: vi.fn(),
}));

vi.mock("@/modules/order/conflict-issue-service", () => ({
  createIssuesForFailedOrders: vi.fn().mockResolvedValue({
    created: 0,
    skippedAsDuplicate: 0,
    failed: 0,
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/get-time", () => ({
  getTime: vi.fn().mockResolvedValue(new Date("2026-05-21T00:00:00Z")),
}));

describe("POST /api/schedule/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireAuth).mockResolvedValue({
      requestId: "test-req",
      user: { id: "user-1", role: "SUPERADMIN" },
    });

    vi.mocked(scheduleEngine.runSchedule).mockResolvedValue({
      failedIds: [],
    } as unknown as Awaited<ReturnType<typeof scheduleEngine.runSchedule>>);

    vi.mocked(
      conflictIssueService.createIssuesForFailedOrders,
    ).mockResolvedValue({
      created: 0,
      skippedAsDuplicate: 0,
      failed: 0,
    });

    // afterEach calls vi.resetAllMocks which wipes the factory's
    // mockResolvedValue, so we restore it here.
    vi.mocked(getTimeModule.getTime).mockResolvedValue(
      new Date("2026-05-21T00:00:00Z"),
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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

  it("should return 401 if not authenticated", async () => {
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
  });

  it("should return 400 if body is invalid", async () => {
    const req = createRequest({}); // Missing 'type'
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should return 409 if already running", async () => {
    vi.mocked(scheduleEngine.runSchedule).mockRejectedValueOnce(
      new Error("already running"),
    );
    const req = createRequest({ type: "Type A" });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("CONFLICT");
  });

  it("should run schedule on success", async () => {
    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe("Schedule run successfully");

    expect(scheduleEngine.runSchedule).toHaveBeenCalledWith(
      "Type A",
      expect.any(Object),
      expect.any(Date),
      "user-1",
    );
  });

  it("should fire-and-forget createIssuesForFailedOrders when there are failed IDs", async () => {
    vi.mocked(scheduleEngine.runSchedule).mockResolvedValueOnce({
      failedIds: ["X1"],
    } as unknown as Awaited<ReturnType<typeof scheduleEngine.runSchedule>>);

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(200);

    // Wait a microtask so the fire-and-forget kicks
    await Promise.resolve();
    await Promise.resolve();

    expect(
      conflictIssueService.createIssuesForFailedOrders,
    ).toHaveBeenCalledTimes(1);
    expect(
      conflictIssueService.createIssuesForFailedOrders,
    ).toHaveBeenCalledWith({
      failedOrderIds: ["X1"],
      actorId: "user-1",
      runConfig: expect.any(Object),
      runAt: expect.any(Date),
      prisma: expect.anything(),
    });
  });

  it("should return 500 if engine throws an unhandled error", async () => {
    vi.mocked(scheduleEngine.runSchedule).mockRejectedValueOnce(
      new Error("Engine failed"),
    );

    const req = createRequest({ type: "Type A" });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
