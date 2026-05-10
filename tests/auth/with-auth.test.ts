import { beforeEach, describe, expect, it } from "vitest";
import { issueAccessToken } from "@/modules/auth/token-service";
import { ForbiddenError } from "@/modules/auth/rbac";
import { withAuth } from "@/modules/auth/with-auth";

describe("withAuth", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("passes the authenticated request context to the route handler", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      accountId: "admin-A1",
    });
    const handler = withAuth(async (_req, ctx) => {
      return Response.json({ requestId: ctx.requestId, user: ctx.user });
    });

    const response = await handler(new Request("http://localhost/api/users", {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-request-id": "req-1",
      },
    }));

    await expect(response.json()).resolves.toEqual({
      requestId: "req-1",
      user: {
        id: "user-1",
        role: "ADMIN",
        accountId: "admin-A1",
      },
    });
  });

  it("returns a standard unauthorized response when authentication fails", async () => {
    const handler = withAuth(async () => Response.json({ ok: true }));

    const response = await handler(new Request("http://localhost/api/users"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Missing or invalid token",
    });
  });

  it("returns a standard forbidden response when authorization fails", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "SALES",
      accountId: "sales-A",
    });
    const handler = withAuth(async () => {
      throw new ForbiddenError("Nope.");
    });

    const response = await handler(new Request("http://localhost/api/users", {
      headers: { Authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Nope.",
    });
  });
});
