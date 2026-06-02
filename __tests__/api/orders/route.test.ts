/**
 * Tests for DELETE /api/orders — concurrency 409 mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/orders/route";
import * as auth from "@/modules/auth/require-auth";
import * as orderService from "@/modules/order/order-service";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {
    status = 401;
    code = "UNAUTHORIZED";
  },
  CsrfError: class CsrfError extends Error {
    status = 403;
    code = "CSRF_FORBIDDEN";
  },
}));

vi.mock("@/modules/auth/rbac", () => ({
  ForbiddenError: class ForbiddenError extends Error {
    status = 403;
    code = "FORBIDDEN";
  },
  forbiddenResponse: vi.fn(
    (err: Error) =>
      new Response(
        JSON.stringify({ code: "FORBIDDEN", message: err.message }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      ),
  ),
  unauthorizedResponse: vi.fn(
    (msg: string) =>
      new Response(JSON.stringify({ code: "UNAUTHORIZED", message: msg }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  ),
  csrfResponse: vi.fn(
    (msg: string) =>
      new Response(JSON.stringify({ code: "CSRF_FORBIDDEN", message: msg }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
  ),
  badRequestResponse: vi.fn(
    (msg: string) =>
      new Response(JSON.stringify({ code: "BAD_REQUEST", message: msg }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  ),
  notFoundResponse: vi.fn(
    (msg?: string) =>
      new Response(JSON.stringify({ code: "NOT_FOUND", message: msg }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
  ),
}));

vi.mock("@/modules/order/order-service", () => ({
  listOrders: vi.fn(),
  createOrderService: vi.fn(),
  deleteOrdersService: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/get-time", () => ({
  getTime: vi.fn().mockResolvedValue(new Date("2026-06-01T00:00:00Z")),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createDeleteRequest = (ids: string[]): NextRequest =>
  new NextRequest("http://localhost/api/orders", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /api/orders — 409 when lock is held", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", username: "admin-a1" },
      requestId: "req-1",
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
  });

  it("returns 409 with CONFLICT code when deleteOrdersService throws 'already running'", async () => {
    vi.mocked(orderService.deleteOrdersService).mockRejectedValue(
      new Error("A scheduling process is already running for type: A"),
    );

    const req = createDeleteRequest(["order-1", "order-2"]);
    const res = await DELETE(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONFLICT");
    expect(body.message).toMatch(/already running/);
  });

  it("returns 200 on successful delete", async () => {
    vi.mocked(orderService.deleteOrdersService).mockResolvedValue({ count: 2 });

    const req = createDeleteRequest(["order-1", "order-2"]);
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
  });
});
