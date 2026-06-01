/**
 * Tests for PUT /api/orders/[id] — concurrency 409 mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PUT } from "@/app/api/orders/[id]/route";
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
  forbiddenResponse: vi.fn((err: Error) =>
    new Response(JSON.stringify({ code: "FORBIDDEN", message: err.message }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
  ),
  unauthorizedResponse: vi.fn((msg: string) =>
    new Response(JSON.stringify({ code: "UNAUTHORIZED", message: msg }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  ),
  csrfResponse: vi.fn((msg: string) =>
    new Response(JSON.stringify({ code: "CSRF_FORBIDDEN", message: msg }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }),
  ),
  badRequestResponse: vi.fn((msg: string) =>
    new Response(JSON.stringify({ code: "BAD_REQUEST", message: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
  ),
  notFoundResponse: vi.fn((msg?: string) =>
    new Response(JSON.stringify({ code: "NOT_FOUND", message: msg }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }),
  ),
}));

vi.mock("@/modules/order/order-service", () => ({
  getOrder: vi.fn(),
  updateOrderService: vi.fn(),
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

const createRequest = (
  id: string,
  body: Record<string, unknown>,
): [Request, { params: Promise<{ id: string }> }] => [
  new Request(`http://localhost/api/orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
  { params: Promise.resolve({ id }) },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT /api/orders/[id] — 409 when lock is held", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", username: "admin-a1" },
      requestId: "req-1",
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);
  });

  it("returns 409 with CONFLICT code when updateOrderService throws 'already running'", async () => {
    vi.mocked(orderService.updateOrderService).mockRejectedValue(
      new Error("A scheduling process is already running for type: A"),
    );

    const [req, ctx] = createRequest("order-1", { isFixed: true });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONFLICT");
    expect(body.message).toMatch(/already running/);
  });

  it("returns 200 on successful update", async () => {
    vi.mocked(orderService.updateOrderService).mockResolvedValue({
      id: "order-1",
      type: "A",
      status: "PENDING" as never,
      isFixed: true,
      isPrioritized: false,
      dueDate: new Date("2026-08-01"),
      quantity: 100,
      name: "Test",
      applicantId: "sales-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastModifiedById: null,
    });

    const [req, ctx] = createRequest("order-1", { isFixed: true });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(200);
  });
});
