import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/schedule/notify/route";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import * as mailTemplate from "@/modules/mail/mail-template";

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  CsrfError: class CsrfError extends Error {
    status = 403;
    code = "CSRF_FORBIDDEN";
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    status = 401;
    code = "UNAUTHORIZED";
  },
}));

vi.mock("@/modules/mail/mail-template", () => ({
  renderAndSend: vi.fn(),
}));

vi.mock("@/modules/mail/templates/kick-out", () => ({
  kickOutTemplate: {
    id: "kick-out-notification",
    name: "mock",
    build: vi.fn(),
  },
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function adminCtx(role: string = "ADMIN") {
  return { requestId: "r1", user: { id: "u1", role } };
}

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/schedule/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sampleOrder = {
  id: "O1",
  name: "Test Order",
  applicantEmail: "sales@example.com",
  applicantUsername: "salesperson",
};

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("POST /api/schedule/notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(adminCtx());
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());

    const res = await POST(makeRequest({ orders: [sampleOrder] }));

    expect(res.status).toBe(401);
  });

  it("returns 403 when role is SALES", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(adminCtx("SALES"));

    const res = await POST(makeRequest({ orders: [sampleOrder] }));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("FORBIDDEN");
  });

  it("returns 400 when orders array is missing", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("BAD_REQUEST");
  });

  it("returns 400 when orders array is empty", async () => {
    const res = await POST(makeRequest({ orders: [] }));

    expect(res.status).toBe(400);
  });

  it("returns 400 when an order has an invalid email", async () => {
    const res = await POST(
      makeRequest({
        orders: [{ ...sampleOrder, applicantEmail: "not-an-email" }],
      }),
    );

    expect(res.status).toBe(400);
  });

  it("sends emails and returns sent IDs on success", async () => {
    vi.mocked(mailTemplate.renderAndSend).mockResolvedValue(undefined);

    const res = await POST(makeRequest({ orders: [sampleOrder] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toContain("O1");
    expect(json.failed).toHaveLength(0);
    expect(mailTemplate.renderAndSend).toHaveBeenCalledOnce();
  });

  it("reports failed order IDs when renderAndSend throws", async () => {
    vi.mocked(mailTemplate.renderAndSend).mockRejectedValue(
      new Error("smtp error"),
    );

    const res = await POST(makeRequest({ orders: [sampleOrder] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toHaveLength(0);
    expect(json.failed).toContain("O1");
  });

  it("handles partial failures across multiple orders", async () => {
    const orders = [
      {
        id: "O1",
        name: "A",
        applicantEmail: "a@e.com",
        applicantUsername: "a",
      },
      {
        id: "O2",
        name: "B",
        applicantEmail: "b@e.com",
        applicantUsername: "b",
      },
      {
        id: "O3",
        name: "C",
        applicantEmail: "c@e.com",
        applicantUsername: null,
      },
    ];

    vi.mocked(mailTemplate.renderAndSend)
      .mockResolvedValueOnce(undefined) // O1 succeeds
      .mockRejectedValueOnce(new Error("x")) // O2 fails
      .mockResolvedValueOnce(undefined); // O3 succeeds

    const res = await POST(makeRequest({ orders }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toEqual(expect.arrayContaining(["O1", "O3"]));
    expect(json.failed).toEqual(["O2"]);
  });

  it("allows SUPERADMIN to send notifications", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(adminCtx("SUPERADMIN"));
    vi.mocked(mailTemplate.renderAndSend).mockResolvedValue(undefined);

    const res = await POST(makeRequest({ orders: [sampleOrder] }));

    expect(res.status).toBe(200);
  });
});
