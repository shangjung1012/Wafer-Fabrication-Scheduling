/**
 * Tests for DELETE /api/orders — concurrency 409 mapping.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "@/app/api/orders/route";
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

const createPostRequest = (body: unknown): NextRequest =>
  new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
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
    });
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

  it("returns listed orders for valid GET filters", async () => {
    vi.mocked(orderService.listOrders).mockResolvedValue([
      { id: "order-1", name: "Alpha", status: "PENDING" },
    ] as Awaited<ReturnType<typeof orderService.listOrders>>);

    const req = new NextRequest(
      "http://localhost/api/orders?status=PENDING&keyword=alpha",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "order-1", name: "Alpha", status: "PENDING" },
    ]);
    expect(orderService.listOrders).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { status: "PENDING", keyword: "alpha" },
    );
  });

  it("returns 400 for invalid GET filters", async () => {
    const req = new NextRequest("http://localhost/api/orders?status=INVALID");
    const res = await GET(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid query parameters.",
    });
    expect(orderService.listOrders).not.toHaveBeenCalled();
  });

  it("creates an order when POST body is valid and due date is not past", async () => {
    vi.mocked(orderService.createOrderService).mockResolvedValue({
      id: "order-1",
      name: "New order",
      type: "A",
      status: "PENDING",
    } as Awaited<ReturnType<typeof orderService.createOrderService>>);

    const res = await POST(
      createPostRequest({
        name: "New order",
        type: "A",
        dueDate: "2026-06-10T00:00:00.000Z",
        quantity: 25,
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "order-1" });
    expect(orderService.createOrderService).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        name: "New order",
        type: "A",
        quantity: 25,
        dueDate: new Date("2026-06-10T00:00:00.000Z"),
      }),
    );
  });

  it("returns 400 for invalid POST JSON and invalid POST bodies", async () => {
    const invalidJson = await POST(createPostRequest("{"));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({
      message: "Request body must be valid JSON.",
    });

    const invalidBody = await POST(createPostRequest({ name: "", type: "Z" }));
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toMatchObject({
      message: "Invalid request body.",
    });
    expect(orderService.createOrderService).not.toHaveBeenCalled();
  });

  it("returns 400 when POST due date is in the past", async () => {
    const res = await POST(
      createPostRequest({
        name: "Past order",
        type: "A",
        dueDate: "2026-05-31T00:00:00.000Z",
        quantity: 25,
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: "Due date cannot be in the past.",
    });
    expect(orderService.createOrderService).not.toHaveBeenCalled();
  });

  it("returns DELETE validation errors before calling the service", async () => {
    const invalidJson = await DELETE(
      new NextRequest("http://localhost/api/orders", {
        method: "DELETE",
        body: "{",
      }),
    );
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toMatchObject({
      message: "Request body must be valid JSON.",
    });

    const invalidBody = await DELETE(createDeleteRequest([]));
    expect(invalidBody.status).toBe(400);
    expect(await invalidBody.json()).toMatchObject({
      message: "Invalid request body.",
    });
    expect(orderService.deleteOrdersService).not.toHaveBeenCalled();
  });
});
