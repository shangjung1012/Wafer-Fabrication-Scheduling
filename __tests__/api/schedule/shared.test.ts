import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireAuth } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth,
  UnauthorizedError: class UnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
    constructor(msg = "Unauthorized") {
      super(msg);
      this.name = "UnauthorizedError";
    }
  },
  CsrfError: class CsrfError extends Error {
    readonly status = 403;
    readonly code = "CSRF_FORBIDDEN";
    constructor(msg = "CSRF") {
      super(msg);
      this.name = "CsrfError";
    }
  },
}));

vi.mock("@/modules/auth/rbac", () => ({
  ForbiddenError: class ForbiddenError extends Error {
    readonly status = 403;
    readonly code = "FORBIDDEN";
    constructor(msg = "Forbidden") {
      super(msg);
      this.name = "ForbiddenError";
    }
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  handleScheduleError,
  SchedulingConfigSchema,
} from "@/app/api/schedule/_shared";
import { UnauthorizedError, CsrfError } from "@/modules/auth/require-auth";
import { ForbiddenError } from "@/modules/auth/rbac";

beforeEach(() => vi.clearAllMocks());

describe("handleScheduleError", () => {
  it("returns 409 CONFLICT for 'already running' errors", async () => {
    const err = new Error("schedule already running");
    const res = handleScheduleError(err, "run schedule");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CONFLICT");
  });

  it("returns 409 CONFLICT for 'environment has changed' errors", async () => {
    const err = new Error("environment has changed");
    const res = handleScheduleError(err, "apply schedule");
    expect(res.status).toBe(409);
  });

  it("returns 401 for UnauthorizedError", async () => {
    const { UnauthorizedError: UE } =
      await import("@/modules/auth/require-auth");
    const res = handleScheduleError(new UE("bad token"), "run schedule");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("returns correct status for CsrfError", async () => {
    const { CsrfError: CE } = await import("@/modules/auth/require-auth");
    const res = handleScheduleError(new CE("bad origin"), "run schedule");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CSRF_FORBIDDEN");
  });

  it("returns 403 for ForbiddenError", async () => {
    const { ForbiddenError: FE } = await import("@/modules/auth/rbac");
    const res = handleScheduleError(new FE("no access"), "run schedule");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("returns 500 for unknown errors", async () => {
    const res = handleScheduleError(new Error("db exploded"), "run schedule");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("SchedulingConfigSchema", () => {
  it("uses defaults when no config is provided", () => {
    const result = SchedulingConfigSchema.parse(undefined);
    expect(result.reschedulePolicy).toBe("GAP_FILLING");
    expect(result.algorithm).toBe("GREEDY_BEST_FIT");
    expect(result.splittable).toBe(true);
    expect(result.frozenDays).toBe(0);
  });

  it("parses a complete config object", () => {
    const result = SchedulingConfigSchema.parse({
      frozenDays: 2,
      productionDays: 10,
      bufferDays: 3,
      reschedulePolicy: "PRIORITY_RETAIN",
      algorithm: "GREEDY_BEST_FIT",
      splittable: false,
    });
    expect(result.frozenDays).toBe(2);
    expect(result.reschedulePolicy).toBe("PRIORITY_RETAIN");
    expect(result.splittable).toBe(false);
  });
});
