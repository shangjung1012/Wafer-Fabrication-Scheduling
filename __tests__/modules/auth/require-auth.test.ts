import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "@/modules/auth/require-auth";
import { issueAccessToken } from "@/modules/auth/token-service";
import { getAuthSession } from "@/modules/auth/session-store";

vi.mock("@/modules/auth/session-store", () => ({
  getAuthSession: vi.fn(async (sessionId) => ({
    sessionId,
    userId: "user-1",
    username: "admin-A1",
    role: "ADMIN",
    createdAt: "2026-05-24T00:00:00.000Z",
    expiresAt: "2026-05-31T00:00:00.000Z",
  })),
}));

describe("requireAuth", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
    process.env.APP_BASE_URL = "http://localhost:3000";
    vi.clearAllMocks();
  });

  afterEach(() => {
    // @ts-expect-error Resetting NODE_ENV for tests
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.DEV_STATIC_TOKEN;
  });

  it("accepts JWT bearer access tokens", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
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
    expect(getAuthSession).toHaveBeenCalledWith("session-1");
  });

  it("accepts cookie access tokens for unsafe methods from the app origin", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
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
      sessionId: "session-1",
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
      sessionId: "session-1",
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
      sessionId: "session-1",
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
      sessionId: "session-1",
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

  it("rejects access tokens when the Redis server session is missing", async () => {
    vi.mocked(getAuthSession).mockResolvedValueOnce(null);
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
    });
    const request = new Request("http://localhost/api/users", {
      headers: { Authorization: `Bearer ${token}` },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("rejects access tokens when the Redis server session belongs to a different user", async () => {
    vi.mocked(getAuthSession).mockResolvedValueOnce({
      sessionId: "session-1",
      userId: "user-2",
      username: "admin-A1",
      role: "ADMIN",
      createdAt: "2026-05-24T00:00:00.000Z",
      expiresAt: "2026-05-31T00:00:00.000Z",
    });
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
    });
    const request = new Request("http://localhost/api/users", {
      headers: { Authorization: `Bearer ${token}` },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("rejects old development dev role tokens", async () => {
    // @ts-expect-error Resetting NODE_ENV for tests
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
    // @ts-expect-error Resetting NODE_ENV for tests
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

  it("allows safe GET requests with cookie token without CSRF origin check", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "GET",
      headers: {
        Cookie: `access_token=${token}`,
        Origin: "https://evil.example",
      },
    });

    await expect(requireAuth(request)).resolves.toMatchObject({
      user: { id: "user-1" },
    });
  });

  it("throws CsrfError when APP_BASE_URL is missing for cookie auth", async () => {
    const savedUrl = process.env.APP_BASE_URL;
    delete process.env.APP_BASE_URL;

    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        Origin: "http://localhost:3000",
      },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "CSRF_FORBIDDEN",
      status: 403,
    });

    process.env.APP_BASE_URL = savedUrl;
  });

  it("rejects cookie auth with invalid referer URL", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
    });
    const request = new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        Referer: "not-a-valid-url",
      },
    });

    await expect(requireAuth(request)).rejects.toMatchObject({
      code: "CSRF_FORBIDDEN",
      status: 403,
    });
  });
});
