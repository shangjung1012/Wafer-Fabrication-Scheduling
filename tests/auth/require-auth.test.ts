import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireAuth } from "@/modules/auth/require-auth";
import { issueAccessToken } from "@/modules/auth/token-service";

describe("requireAuth", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.DEV_STATIC_TOKEN;
  });

  it("accepts JWT bearer access tokens", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
    });
    const request = new Request("http://localhost/api/users", {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-request-id": "req-1",
      },
    });

    await expect(requireAuth(request)).resolves.toEqual({
      requestId: "req-1",
      user: {
        id: "user-1",
        role: "ADMIN",
        username: "admin-A1",
      },
    });
  });

  it("accepts cookie access tokens for unsafe methods from the app origin", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        Origin: "http://localhost:3000",
      },
    });

    await expect(requireAuth(request)).resolves.toMatchObject({
      user: {
        id: "user-1",
        role: "ADMIN",
        username: "admin-A1",
      },
    });
  });

  it("rejects cookie access tokens for unsafe cross-origin requests", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        Origin: "https://evil.example",
      },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "CSRF_FORBIDDEN",
      status: 403,
    });
  });

  it("rejects cookie access tokens for unsafe requests without a valid origin", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        Origin: "null",
      },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "CSRF_FORBIDDEN",
      status: 403,
    });
  });

  it("allows same-origin referer when origin is absent", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        Referer: "http://localhost:3000/orders",
      },
    });

    await expect(requireAuth(request)).resolves.toMatchObject({
      user: { id: "user-1" },
    });
  });

  it("does not apply CSRF origin checks to bearer access tokens", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://evil.example",
      },
    });

    await expect(requireAuth(request)).resolves.toMatchObject({
      user: { id: "user-1" },
    });
  });

  it("rejects old development dev role tokens", async () => {
    process.env.NODE_ENV = "development";
    const request = new Request("http://localhost/api/users", {
      headers: {
        Authorization: "Bearer dev:SUPERADMIN:sa-A",
        "x-request-id": "req-dev-token",
      },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("rejects old static dev tokens", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_STATIC_TOKEN = "dev-superadmin-static-token";
    const request = new Request("http://localhost/api/users", {
      headers: {
        Authorization: "Bearer dev-superadmin-static-token",
        "x-request-id": "req-static-dev-token",
      },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });
});
