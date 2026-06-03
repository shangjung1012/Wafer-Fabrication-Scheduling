/**
 * Tests for PUT /api/orders/[id] — concurrency 409 mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/orders/[id]/route";
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
  body: Record<string, unknown> | string,
): [NextRequest, { params: Promise<{ id: string }> }] => [
  new NextRequest(`http://localhost/api/orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }),
  { params: Promise.resolve({ id }) },
];

const createGetRequest = (
  id: string,
): [NextRequest, { params: Promise<{ id: string }> }] => [
  new NextRequest(`http://localhost/api/orders/${id}`),
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
    });
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

  it("returns an order for GET /api/orders/[id]", async () => {
    vi.mocked(orderService.getOrder).mockResolvedValue({
      id: "order-1",
      name: "Order One",
      type: "A",
      status: "PENDING",
    } as Awaited<ReturnType<typeof orderService.getOrder>>);

    const [req, ctx] = createGetRequest("order-1");
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "order-1",
      name: "Order One",
      type: "A",
      status: "PENDING",
    });
    expect(orderService.getOrder).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      "order-1",
    );
  });

  it("maps not-found errors on GET", async () => {
    vi.mocked(orderService.getOrder).mockRejectedValue({
      status: 404,
      message: "Order not found.",
    });

    const [req, ctx] = createGetRequest("missing");
    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      code: "NOT_FOUND",
      message: "Order not found.",
    });
  });

  it("returns 400 for invalid PUT JSON, invalid bodies, and empty updates", async () => {
    const [invalidJsonReq, invalidJsonCtx] = createRequest("order-1", "{");
    const invalidJson = await PUT(invalidJsonReq, invalidJsonCtx);
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({
      message: "Request body must be valid JSON.",
    });

    const [invalidBodyReq, invalidBodyCtx] = createRequest("order-1", {
      unknown: true,
    });
    const invalidBody = await PUT(invalidBodyReq, invalidBodyCtx);
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toMatchObject({
      message: "Invalid request body.",
    });

    const [emptyReq, emptyCtx] = createRequest("order-1", {});
    const empty = await PUT(emptyReq, emptyCtx);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      message: "At least one field is required.",
    });
    expect(orderService.updateOrderService).not.toHaveBeenCalled();
  });

  it("returns 400 when PUT due date is in the past", async () => {
    const [req, ctx] = createRequest("order-1", {
      dueDate: "2026-05-31T00:00:00.000Z",
    });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: "Due date cannot be in the past.",
    });
    expect(orderService.updateOrderService).not.toHaveBeenCalled();
  });

  it("maps environment-version conflicts on PUT", async () => {
    vi.mocked(orderService.updateOrderService).mockRejectedValue(
      new Error("Schedule environment has changed. Please refresh."),
    );

    const [req, ctx] = createRequest("order-1", {
      name: "Updated",
      expectedScheduleVersion: 3,
    });
    const res = await PUT(req, ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: "Schedule environment has changed. Please refresh.",
    });
  });
});
