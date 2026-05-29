import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/schedule/apply/route";
import * as auth from "@/modules/auth/require-auth";
import { resolveActorScope } from "@/modules/auth/scope";
import * as scheduleOrchestrator from "@/modules/order/schedule-orchestrator";
import * as scheduleStore from "@/infra/redis/schedule-store";

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  CsrfError: class CsrfError extends Error {
    code = "CSRF_ERROR";
    status = 403;
  },
}));

vi.mock("@/modules/auth/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/auth/scope")>();
  return {
    ...actual,
    resolveActorScope: vi.fn(),
  };
});

vi.mock("@/modules/order/schedule-orchestrator", () => ({
  applyScheduleTransactionWithIssues: vi.fn(),
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

    vi.mocked(resolveActorScope).mockResolvedValue({
      role: "ADMIN",
      userId: "U1",
      factoryIds: ["factory-A1"],
      productionType: "A",
      group: "A",
    });

    vi.mocked(
      scheduleOrchestrator.applyScheduleTransactionWithIssues,
    ).mockResolvedValue({
      failedIds: [],
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
      type: "A",
      version: 1,
      config: {},
      result: {},
    });
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);
    vi.mocked(
      scheduleOrchestrator.applyScheduleTransactionWithIssues,
    ).mockRejectedValue(new Error("already running"));

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.message).toMatch(/already running/);
  });

  it("should return 409 if version mismatched (bubbled from core)", async () => {
    vi.mocked(scheduleStore.getPreview).mockResolvedValue({
      type: "A",
      version: 1,
      config: {},
      result: {},
    });
    vi.mocked(
      scheduleOrchestrator.applyScheduleTransactionWithIssues,
    ).mockRejectedValue(
      new Error("Schedule environment has changed. Please preview again."),
    );

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.message).toMatch(/Schedule environment has changed/);
  });

  it("should apply schedule, increment version, delete preview", async () => {
    const payload = {
      type: "A",
      version: 1,
      config: { splittable: true },
      result: { processedOrders: [] },
    };
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(payload);

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(200);

    expect(
      scheduleOrchestrator.applyScheduleTransactionWithIssues,
    ).toHaveBeenCalledWith({
      type: payload.type,
      config: payload.config,
      result: payload.result,
      operatorId: "U1",
      runAt: new Date("2026-05-21T00:00:00Z"),
      expectedVersion: payload.version,
      previewId: "valid-123",
    });
  });

  it("should return 200 when the orchestrator reports failed order ids", async () => {
    const payload = {
      type: "A",
      version: 1,
      config: { splittable: true },
      result: { processedOrders: [] },
    };
    vi.mocked(scheduleStore.getPreview).mockResolvedValue(payload);
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(1);
    vi.mocked(
      scheduleOrchestrator.applyScheduleTransactionWithIssues,
    ).mockResolvedValue({
      failedIds: ["O1", "O2"],
    });

    const res = await POST(createRequest({ previewId: "valid-123" }));
    expect(res.status).toBe(200);
    expect(
      scheduleOrchestrator.applyScheduleTransactionWithIssues,
    ).toHaveBeenCalledTimes(1);
  });
});
