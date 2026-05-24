import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as requestEmailChangePost } from "@/app/api/users/me/request-email-change/route";
import * as verifyEmailRoute from "@/app/api/users/me/verify-email/route";

const { prisma, requireAuth, verifyPassword, renderAndSend } = vi.hoisted(
  () => ({
    prisma: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      emailChangeToken: {
        create: vi.fn(),
        deleteMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
    requireAuth: vi.fn(),
    verifyPassword: vi.fn(),
    renderAndSend: vi.fn(),
  }),
);

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/modules/auth/require-auth", () => ({
  CsrfError: class CsrfError extends Error {
    readonly status = 403;
    readonly code = "CSRF_FORBIDDEN";
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  },
  requireAuth,
}));
vi.mock("@/modules/auth/password-service", () => ({ verifyPassword }));
vi.mock("@/modules/mail/mail-template", () => ({ renderAndSend }));

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/users/me/request-email-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("email change routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "http://localhost";
    requireAuth.mockResolvedValue({
      requestId: "request-1",
      user: { id: "user-1", username: "sales-a", role: "SALES" },
    });
    verifyPassword.mockResolvedValue(true);
    renderAndSend.mockResolvedValue(undefined);
    prisma.user.findUnique.mockImplementation(
      async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id === "user-1") {
          return {
            password: "hashed-password",
            email: "old@example.com",
            username: "sales-a",
          };
        }
        return null;
      },
    );
    prisma.emailChangeToken.deleteMany.mockResolvedValue({ count: 0 });
    prisma.emailChangeToken.create.mockResolvedValue({ id: "token-row-1" });
  });

  it("stores only a hashed email change token and sends the raw token by email", async () => {
    const response = await requestEmailChangePost(
      jsonRequest({
        newEmail: "new@example.com",
        currentPassword: "Password123!",
      }),
    );

    expect(response.status).toBe(200);
    const createArg = prisma.emailChangeToken.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArg.data.token).toBeUndefined();
    expect(createArg.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const verifyMailArg = renderAndSend.mock.calls[0][1] as {
      verifyUrl: string;
    };
    expect(verifyMailArg.verifyUrl).toContain(
      "http://localhost/api/users/me/verify-email?token=",
    );
    expect(verifyMailArg.verifyUrl).not.toContain(
      String(createArg.data.tokenHash),
    );
  });

  it("does not keep the request pending when a non-critical email send does not settle", async () => {
    renderAndSend
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(new Promise(() => undefined));

    const responsePromise = requestEmailChangePost(
      jsonRequest({
        newEmail: "new@example.com",
        currentPassword: "Password123!",
      }),
    );

    await expect(
      Promise.race([
        responsePromise,
        new Promise<"pending">((resolve) =>
          setTimeout(() => resolve("pending"), 0),
        ),
      ]),
    ).resolves.not.toBe("pending");

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(renderAndSend).toHaveBeenCalledTimes(2);
  });

  it("does not mutate email state on GET verification links", async () => {
    const response = await verifyEmailRoute.GET(
      new Request("http://localhost/api/users/me/verify-email?token=raw-token"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/profile?emailChangeToken=raw-token",
    );
    expect(prisma.emailChangeToken.findUnique).not.toHaveBeenCalled();
    expect(prisma.emailChangeToken.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirms email changes only through POST and claims a token once", async () => {
    expect(verifyEmailRoute.POST).toBeTypeOf("function");
    prisma.emailChangeToken.findUnique.mockResolvedValue({
      id: "token-row-1",
      userId: "user-1",
      newEmail: "new@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.emailChangeToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.user.update.mockResolvedValue({ id: "user-1" });
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );

    const request = () =>
      new Request("http://localhost/api/users/me/verify-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ token: "raw-token" }),
      });

    const [first, second] = await Promise.all([
      verifyEmailRoute.POST(request()),
      verifyEmailRoute.POST(request()),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 400]);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });
});
