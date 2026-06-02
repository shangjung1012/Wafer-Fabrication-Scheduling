import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/system/auto-scheduler/route";
import { CsrfError, UnauthorizedError } from "@/modules/auth/require-auth";
import { ForbiddenError } from "@/modules/auth/rbac";
import { assertCanManageScheduleType } from "@/modules/schedule/access-control";

const {
  prisma,
  requireAuth,
  getAutoSchedulerConfigs,
  updateAutoSchedulerConfig,
} = vi.hoisted(() => ({
  prisma: {},
  requireAuth: vi.fn(),
  getAutoSchedulerConfigs: vi.fn(),
  updateAutoSchedulerConfig: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth,
  UnauthorizedError: class MockUnauthorizedError extends Error {
    readonly status = 401 as const;
    readonly code = "UNAUTHORIZED" as const;
    constructor(message = "Missing or invalid token") {
      super(message);
      this.name = "UnauthorizedError";
    }
  },
  CsrfError: class MockCsrfError extends Error {
    readonly status = 403 as const;
    readonly code = "CSRF_FORBIDDEN" as const;
    constructor(message = "Request origin is not allowed.") {
      super(message);
      this.name = "CsrfError";
    }
  },
}));
vi.mock("@/infra/db/auto-scheduler-config-repository", () => ({
  getAutoSchedulerConfigs,
  updateAutoSchedulerConfig,
}));
vi.mock("@/modules/schedule/access-control", () => ({
  assertCanManageScheduleType: vi.fn(),
}));

describe("/api/system/auto-scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({
      requestId: "r1",
      user: { id: "admin-1", role: "ADMIN", username: "admin-A" },
    });
    vi.mocked(assertCanManageScheduleType).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("returns auto scheduler configs when authenticated", async () => {
      const configs = [
        { type: "A", isOperating: true, reschedulePolicy: "GAP_FILLING" },
      ];
      getAutoSchedulerConfigs.mockResolvedValueOnce(configs);

      const res = await GET(
        new Request("http://localhost/api/system/auto-scheduler"),
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual(configs);
      expect(getAutoSchedulerConfigs).toHaveBeenCalledWith(prisma);
    });

    it("returns 401 when unauthenticated", async () => {
      requireAuth.mockRejectedValueOnce(new UnauthorizedError());

      const res = await GET(
        new Request("http://localhost/api/system/auto-scheduler"),
      );

      expect(res.status).toBe(401);
      expect(getAutoSchedulerConfigs).not.toHaveBeenCalled();
    });
  });

  describe("PATCH", () => {
    function patchRequest(body: unknown): Request {
      return new Request("http://localhost/api/system/auto-scheduler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("checks schedule type scope before updating config", async () => {
      const updated = {
        type: "A",
        isOperating: false,
        reschedulePolicy: "GAP_FILLING",
      };
      updateAutoSchedulerConfig.mockResolvedValueOnce(updated);

      const res = await PATCH(patchRequest({ type: "A", isOperating: false }));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual(updated);
      expect(assertCanManageScheduleType).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({ role: "ADMIN" }),
        }),
        prisma,
        "A",
      );
      expect(updateAutoSchedulerConfig).toHaveBeenCalledWith(prisma, "A", {
        isOperating: false,
      });
    });

    it("returns 403 and does not update when admin cannot manage the type", async () => {
      vi.mocked(assertCanManageScheduleType).mockRejectedValueOnce(
        new ForbiddenError(
          "You can only manage schedules in your production group.",
        ),
      );

      const res = await PATCH(patchRequest({ type: "B", isOperating: false }));

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: "FORBIDDEN",
        message: "You can only manage schedules in your production group.",
      });
      expect(updateAutoSchedulerConfig).not.toHaveBeenCalled();
    });

    it("returns 400 when body fails validation", async () => {
      const res = await PATCH(patchRequest({ type: "A", frozenDays: -1 }));

      expect(res.status).toBe(400);
      expect(assertCanManageScheduleType).not.toHaveBeenCalled();
      expect(updateAutoSchedulerConfig).not.toHaveBeenCalled();
    });

    it("returns 403 for CSRF-style auth errors", async () => {
      requireAuth.mockRejectedValueOnce(new CsrfError());

      const res = await PATCH(patchRequest({ type: "A" }));

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: "CSRF_FORBIDDEN",
      });
      expect(updateAutoSchedulerConfig).not.toHaveBeenCalled();
    });
  });
});
