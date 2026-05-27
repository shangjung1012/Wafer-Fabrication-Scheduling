import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { CsrfError } from "@/modules/auth/require-auth";

const {
  prisma,
  login,
  logout,
  refresh,
  getCookieValue,
  setAuthCookies,
  clearAuthCookies,
  requireSameOriginForCookieAuth,
} = vi.hoisted(() => ({
  prisma: {},
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  getCookieValue: vi.fn(),
  setAuthCookies: vi.fn(),
  clearAuthCookies: vi.fn(),
  requireSameOriginForCookieAuth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/modules/auth/auth-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/auth/auth-service")>();
  return {
    ...actual,
    login,
    logout,
    refresh,
  };
});
vi.mock("@/app/api/auth/_cookies", () => ({
  ACCESS_TOKEN_COOKIE: "access_token",
  REFRESH_TOKEN_COOKIE: "refresh_token",
  getCookieValue,
  setAuthCookies,
  clearAuthCookies,
}));
vi.mock("@/modules/auth/require-auth", () => ({
  requireSameOriginForCookieAuth,
  CsrfError: class MockCsrfError extends Error {
    readonly status = 403 as const;
    readonly code = "CSRF_FORBIDDEN" as const;
    constructor(message = "Request origin is not allowed.") {
      super(message);
      this.name = "CsrfError";
    }
  },
}));

function jsonRequest(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Request {
  return new Request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("auth routes (mocked branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "http://localhost";
    login.mockResolvedValue({
      user: { id: "u1", username: "alice", role: "ADMIN" },
      accessToken: "at",
      refreshToken: "rt",
    });
    logout.mockResolvedValue({ ok: true });
    refresh.mockResolvedValue({
      user: { id: "u1", username: "alice", role: "ADMIN" },
      accessToken: "at2",
      refreshToken: "rt2",
    });
    getCookieValue.mockReturnValue(undefined);
    requireSameOriginForCookieAuth.mockImplementation(() => undefined);
  });

  describe("POST /api/auth/login", () => {
    it("returns 400 when JSON body is invalid", async () => {
      const res = await loginPost(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        }),
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: "BAD_REQUEST" });
      expect(login).not.toHaveBeenCalled();
    });

    it("returns 400 when validation fails", async () => {
      const res = await loginPost(
        jsonRequest("http://localhost/api/auth/login", {
          username: "",
          password: "x",
        }),
      );
      expect(res.status).toBe(400);
      expect(login).not.toHaveBeenCalled();
    });

    it("returns 200 and sets cookies on success", async () => {
      const res = await loginPost(
        jsonRequest("http://localhost/api/auth/login", {
          username: "alice",
          password: "secret",
        }),
      );
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        user: { id: "u1", username: "alice", role: "ADMIN" },
      });
      expect(login).toHaveBeenCalledWith(prisma, {
        username: "alice",
        password: "secret",
      });
      expect(setAuthCookies).toHaveBeenCalledTimes(1);
    });

    it("maps InvalidCredentialsError to 401", async () => {
      const { InvalidCredentialsError } = await import(
        "@/modules/auth/auth-service"
      );
      login.mockRejectedValueOnce(new InvalidCredentialsError());
      const res = await loginPost(
        jsonRequest("http://localhost/api/auth/login", {
          username: "alice",
          password: "wrong",
        }),
      );
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    });
  });

  describe("POST /api/auth/logout", () => {
    it("uses JSON body when refresh cookie is absent", async () => {
      const res = await logoutPost(
        jsonRequest("http://localhost/api/auth/logout", {
          refreshToken: "body-rt",
        }),
      );
      expect(res.status).toBe(200);
      expect(requireSameOriginForCookieAuth).not.toHaveBeenCalled();
      expect(logout).toHaveBeenCalledWith(prisma, {
        refreshToken: "body-rt",
      });
      expect(clearAuthCookies).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when JSON is invalid and no cookie token", async () => {
      const res = await logoutPost(
        new Request("http://localhost/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
      );
      expect(res.status).toBe(400);
      expect(logout).not.toHaveBeenCalled();
    });

    it("returns 400 when body omits refreshToken and no cookie", async () => {
      const res = await logoutPost(
        jsonRequest("http://localhost/api/auth/logout", {}),
      );
      expect(res.status).toBe(400);
      expect(logout).not.toHaveBeenCalled();
    });

    it("uses cookie refresh token and enforces same-origin", async () => {
      getCookieValue.mockReturnValue("cookie-rt");
      const res = await logoutPost(
        new Request("http://localhost/api/auth/logout", {
          method: "POST",
          headers: {
            Cookie: "refresh_token=cookie-rt",
            Origin: "http://localhost",
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(requireSameOriginForCookieAuth).toHaveBeenCalledTimes(1);
      expect(logout).toHaveBeenCalledWith(prisma, {
        refreshToken: "cookie-rt",
      });
      expect(clearAuthCookies).toHaveBeenCalledTimes(1);
    });

    it("returns 403 when same-origin check fails (cookie path)", async () => {
      getCookieValue.mockReturnValue("cookie-rt");
      requireSameOriginForCookieAuth.mockImplementationOnce(() => {
        throw new CsrfError();
      });
      const res = await logoutPost(
        new Request("http://localhost/api/auth/logout", {
          method: "POST",
          headers: { Cookie: "refresh_token=cookie-rt" },
        }),
      );
      expect(res.status).toBe(403);
      expect(logout).not.toHaveBeenCalled();
    });

    it("maps InvalidRefreshTokenError from service to 401", async () => {
      const { InvalidRefreshTokenError } = await import(
        "@/modules/auth/auth-service"
      );
      logout.mockRejectedValueOnce(new InvalidRefreshTokenError());
      const res = await logoutPost(
        jsonRequest("http://localhost/api/auth/logout", {
          refreshToken: "bad",
        }),
      );
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_REFRESH_TOKEN",
      });
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("parses refresh token from body when cookie missing", async () => {
      const res = await refreshPost(
        jsonRequest("http://localhost/api/auth/refresh", {
          refreshToken: "body-rt",
        }),
      );
      expect(res.status).toBe(200);
      expect(requireSameOriginForCookieAuth).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledWith(prisma, {
        refreshToken: "body-rt",
      });
      expect(setAuthCookies).toHaveBeenCalledTimes(1);
    });

    it("returns 400 for invalid JSON without cookie", async () => {
      const res = await refreshPost(
        new Request("http://localhost/api/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        }),
      );
      expect(res.status).toBe(400);
      expect(refresh).not.toHaveBeenCalled();
    });

    it("returns 400 when refreshToken missing in body", async () => {
      const res = await refreshPost(
        jsonRequest("http://localhost/api/auth/refresh", {}),
      );
      expect(res.status).toBe(400);
      expect(refresh).not.toHaveBeenCalled();
    });

    it("uses cookie token and same-origin on cookie path", async () => {
      getCookieValue.mockReturnValue("cookie-rt");
      const res = await refreshPost(
        new Request("http://localhost/api/auth/refresh", {
          method: "POST",
          headers: {
            Cookie: "refresh_token=cookie-rt",
            Origin: "http://localhost",
          },
        }),
      );
      expect(res.status).toBe(200);
      expect(requireSameOriginForCookieAuth).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledWith(prisma, {
        refreshToken: "cookie-rt",
      });
    });

    it("returns 403 when cookie path fails CSRF", async () => {
      getCookieValue.mockReturnValue("cookie-rt");
      requireSameOriginForCookieAuth.mockImplementationOnce(() => {
        throw new CsrfError();
      });
      const res = await refreshPost(
        new Request("http://localhost/api/auth/refresh", {
          method: "POST",
          headers: { Cookie: "refresh_token=cookie-rt" },
        }),
      );
      expect(res.status).toBe(403);
      expect(refresh).not.toHaveBeenCalled();
    });

    it("returns 401 for invalid refresh token from service", async () => {
      const { InvalidRefreshTokenError } = await import(
        "@/modules/auth/auth-service"
      );
      refresh.mockRejectedValueOnce(new InvalidRefreshTokenError());
      const res = await refreshPost(
        jsonRequest("http://localhost/api/auth/refresh", {
          refreshToken: "bad",
        }),
      );
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        code: "INVALID_REFRESH_TOKEN",
      });
    });
  });
});
