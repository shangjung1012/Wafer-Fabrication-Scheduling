import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { requireAuth } = vi.hoisted(() => ({ requireAuth: vi.fn() }));

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
  forbiddenResponse: vi.fn(
    (err: { status: number; code: string; message: string }) =>
      new Response(JSON.stringify({ code: err.code, message: err.message }), {
        status: err.status,
      }),
  ),
  unauthorizedResponse: vi.fn(
    (msg: string) =>
      new Response(JSON.stringify({ code: "UNAUTHORIZED", message: msg }), {
        status: 401,
      }),
  ),
  csrfResponse: vi.fn(
    (msg: string) =>
      new Response(JSON.stringify({ code: "CSRF_FORBIDDEN", message: msg }), {
        status: 403,
      }),
  ),
  badRequestResponse: vi.fn(
    (msg: string) =>
      new Response(JSON.stringify({ code: "BAD_REQUEST", message: msg }), {
        status: 400,
      }),
  ),
  notFoundResponse: vi.fn(
    (msg?: string) =>
      new Response(JSON.stringify({ code: "NOT_FOUND", message: msg }), {
        status: 404,
      }),
  ),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { handleCommentAction } from "@/app/api/conflict-issues/[id]/comments/[cid]/_shared";
import type { RequestContext } from "@/modules/auth/request-context";

function makeReq(): NextRequest {
  return new NextRequest(
    "http://localhost/api/conflict-issues/1/comments/c1/accept",
    { method: "POST" },
  );
}

function makeParams(cid = "c-1"): Promise<{ id: string; cid: string }> {
  return Promise.resolve({ id: "i-1", cid });
}

const ctx: RequestContext = {
  user: { id: "u-1", role: "ADMIN" },
  requestId: "r-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAuth.mockResolvedValue(ctx);
});

describe("handleCommentAction", () => {
  it("calls the action and returns 200 ok on success", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const res = await handleCommentAction(makeReq(), makeParams(), action);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(action).toHaveBeenCalledWith(ctx, "c-1");
  });

  it("returns 401 for UnauthorizedError", async () => {
    const { UnauthorizedError: UE } =
      await import("@/modules/auth/require-auth");
    requireAuth.mockRejectedValue(new UE("bad token"));
    const res = await handleCommentAction(makeReq(), makeParams(), vi.fn());
    expect(res.status).toBe(401);
  });

  it("returns 403 for ForbiddenError", async () => {
    const { ForbiddenError: FE } = await import("@/modules/auth/rbac");
    const action = vi.fn().mockRejectedValue(new FE("no access"));
    const res = await handleCommentAction(makeReq(), makeParams(), action);
    expect(res.status).toBe(403);
  });

  it("returns 404 for status-404 error", async () => {
    const action = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("not found"), { status: 404 }),
      );
    const res = await handleCommentAction(makeReq(), makeParams(), action);
    expect(res.status).toBe(404);
  });

  it("returns 400 for status-400 error", async () => {
    const action = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("bad"), { status: 400 }));
    const res = await handleCommentAction(makeReq(), makeParams(), action);
    expect(res.status).toBe(400);
  });

  it("returns 409 for status-409 error", async () => {
    const action = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    const res = await handleCommentAction(makeReq(), makeParams(), action);
    expect(res.status).toBe(409);
  });

  it("rethrows unknown errors", async () => {
    const action = vi
      .fn()
      .mockRejectedValue(new Error("unexpected db failure"));
    await expect(
      handleCommentAction(makeReq(), makeParams(), action),
    ).rejects.toThrow("unexpected db failure");
  });
});
