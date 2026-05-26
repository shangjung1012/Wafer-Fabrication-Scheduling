import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/schedule/apply/route";
import * as auth from "@/modules/auth/require-auth";
import * as scheduleCore from "@/modules/schedule/core";
import * as scheduleStore from "@/infra/redis/schedule-store";
import * as conflictIssueService from "@/modules/order/conflict-issue-service";

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

vi.mock("@/lib/redis", () => ({
  getRedis: vi.fn(),
}));

vi.mock("@/modules/order/conflict-issue-service", () => ({
  createIssuesForFailedOrders: vi.fn().mockResolvedValue({
    created: 0,
    skippedAsDuplicate: 0,
    failed: 0,
  }),
}));

vi.mock("@/lib/get-time", () => ({
  getTime: vi.fn().mockResolvedValue(new Date("2026-05-21T00:00:00Z")),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

describe("POST /api/schedule/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    vi.mocked(scheduleCore.applyScheduleTransaction).mockResolvedValue({
      failedIds: [],
    } as unknown as Awaited<
      ReturnType<typeof scheduleCore.applyScheduleTransaction>
    >);

    vi.mocked(
      conflictIssueService.createIssuesForFailedOrders,
    ).mockResolvedValue({
      created: 0,
      skippedAsDuplicate: 0,
      failed: 0,
    });
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

  it("should return 409 if unable to acquire lock (already running)", async () => {
    vi.mocked(scheduleStore.getPreview).mockResolvedValue({
      type: "Type A",
      version: 1,
      config: {},
      result: {},
    });
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);
    vi.mocked(scheduleCore.applyScheduleTransaction).mockRejectedValue(
      new Error("already running"),
    );

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.message).toMatch(/already running/);
  });

  it("should return 409 if version mismatched", async () => {
    vi.mocked(scheduleStore.getPreview).mockResolvedValue({
      type: "Type A",
      version: 1,
      config: {},
      result: {},
    });
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(2); // Mismatched version

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.message).toMatch(/Schedule environment has changed/);
  });

  it("should apply schedule, increment version, delete preview", async () => {
    const payload = {
      type: "Type A",
      version: 1,
      config: { splittable: true },
      result: { processedOrders: [] },
    };
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(payload);
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(200);

    expect(scheduleCore.applyScheduleTransaction).toHaveBeenCalledWith(
      payload.type,
      payload.config,
      payload.result,
      "U1",
    );
    expect(scheduleStore.incrementScheduleVersion).toHaveBeenCalledWith(
      "Type A",
    );
    expect(scheduleStore.deletePreview).toHaveBeenCalledWith("valid-123");
  });

  it("should fire-and-forget createIssuesForFailedOrders when there are failed IDs", async () => {
    const payload = {
      type: "Type A",
      version: 1,
      config: { splittable: true },
      result: { processedOrders: [] },
    };
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(payload);
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);
    vi.mocked(scheduleCore.applyScheduleTransaction).mockResolvedValue({
      failedIds: ["O1", "O2"],
    } as unknown as Awaited<
      ReturnType<typeof scheduleCore.applyScheduleTransaction>
    >);

    const res = await POST(createRequest({ previewId: "valid-123" }));
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
      failedOrderIds: ["O1", "O2"],
      actorId: "U1",
      runConfig: payload.config,
      runAt: new Date("2026-05-21T00:00:00Z"),
      prisma: expect.anything(),
    });
  });

  it("should still return 200 if createIssuesForFailedOrders throws", async () => {
    const payload = {
      type: "Type A",
      version: 1,
      config: { splittable: true },
      result: { processedOrders: [] },
    };
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(payload);
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);
    vi.mocked(scheduleCore.applyScheduleTransaction).mockResolvedValue({
      failedIds: ["O1"],
    } as unknown as Awaited<
      ReturnType<typeof scheduleCore.applyScheduleTransaction>
    >);
    vi.mocked(
      conflictIssueService.createIssuesForFailedOrders,
    ).mockRejectedValueOnce(new Error("issue service failed"));

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(200);

    // Allow the fire-and-forget rejection to settle
    await Promise.resolve();
    await Promise.resolve();
  });
});
