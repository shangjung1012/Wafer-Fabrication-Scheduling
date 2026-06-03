import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  requireRole,
  forbiddenResponse,
  unauthorizedResponse,
  csrfResponse,
  badRequestResponse,
  notFoundResponse,
} from "@/modules/auth/rbac";
import type { RequestContext } from "@/modules/auth/request-context";

function ctx(role: RequestContext["user"]["role"]): RequestContext {
  return { user: { id: "user-1", role }, requestId: "req-1" };
}

describe("ForbiddenError", () => {
  it("has status 403 and code FORBIDDEN", () => {
    const err = new ForbiddenError("denied");
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("denied");
    expect(err.name).toBe("ForbiddenError");
  });

  it("uses default message when none provided", () => {
    const err = new ForbiddenError();
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe("NotFoundError", () => {
  it("has status 404 and code NOT_FOUND", () => {
    const err = new NotFoundError("gone");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("gone");
    expect(err.name).toBe("NotFoundError");
  });

  it("uses default message when none provided", () => {
    const err = new NotFoundError();
    expect(err.message.length).toBeGreaterThan(0);
  });
});

describe("requireRole", () => {
  it("does not throw when role is allowed", () => {
    expect(() => requireRole(ctx("SUPERADMIN"), ["SUPERADMIN"])).not.toThrow();
    expect(() =>
      requireRole(ctx("ADMIN"), ["ADMIN", "SUPERADMIN"]),
    ).not.toThrow();
  });

  it("throws ForbiddenError when role is not allowed", () => {
    expect(() => requireRole(ctx("SALES"), ["ADMIN", "SUPERADMIN"])).toThrow(
      ForbiddenError,
    );
    expect(() => requireRole(ctx("ADMIN"), ["SUPERADMIN"])).toThrow(
      ForbiddenError,
    );
  });

  it("includes the role name in the error message", () => {
    const err = (() => {
      try {
        requireRole(ctx("SALES"), ["ADMIN"]);
      } catch (e) {
        return e as ForbiddenError;
      }
    })();
    expect(err?.message).toContain("SALES");
  });
});

describe("response helpers", () => {
  it("forbiddenResponse returns 403 JSON", async () => {
    const err = new ForbiddenError("no access");
    const res = forbiddenResponse(err);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toBe("no access");
  });

  it("unauthorizedResponse returns 401 JSON", async () => {
    const res = unauthorizedResponse("bad token");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.message).toBe("bad token");
  });

  it("unauthorizedResponse uses default message", async () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { message: string };
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("csrfResponse returns 403 with CSRF_FORBIDDEN code", async () => {
    const res = csrfResponse("origin blocked");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CSRF_FORBIDDEN");
  });

  it("badRequestResponse returns 400 with optional details", async () => {
    const res = badRequestResponse("invalid input", { field: "name" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      message: string;
      details: Record<string, unknown>;
    };
    expect(body.code).toBe("BAD_REQUEST");
    expect(body.message).toBe("invalid input");
    expect(body.details).toEqual({ field: "name" });
  });

  it("badRequestResponse works without details", async () => {
    const res = badRequestResponse("oops");
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.details).toBeUndefined();
  });

  it("notFoundResponse returns 404 with NOT_FOUND code", async () => {
    const res = notFoundResponse("resource missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("resource missing");
  });

  it("notFoundResponse uses default message", async () => {
    const res = notFoundResponse();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message.length).toBeGreaterThan(0);
  });
});
