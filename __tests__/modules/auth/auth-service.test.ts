import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountLockedError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  SelfRegistrationDisabledError,
  login,
  logout,
  refresh,
  register,
} from "@/modules/auth/auth-service";
import { hashPassword } from "@/modules/auth/password-service";
import {
  hashRefreshToken,
  verifyAccessToken,
} from "@/modules/auth/token-service";

vi.mock("@/modules/auth/session-store", () => ({
  createAuthSession: vi.fn(async (user, now = new Date()) => ({
    sessionId: `session-${user.id}`,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })),
  deleteAuthSession: vi.fn(async () => undefined),
  getAuthSession: vi.fn(async (sessionId) => ({
    sessionId,
    userId: "user-1",
    username: "admin-A1",
    role: "ADMIN",
    createdAt: "2026-05-24T00:00:00.000Z",
    expiresAt: "2026-05-31T00:00:00.000Z",
  })),
  touchAuthSession: vi.fn(async (session, now = new Date()) => ({
    ...session,
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })),
}));

import {
  createAuthSession,
  deleteAuthSession,
  getAuthSession,
  touchAuthSession,
} from "@/modules/auth/session-store";

function createDb() {
  type Row = Record<string, unknown>;
  const users: Row[] = [];
  const refreshTokens: Row[] = [];
  let userSeq = 0;
  let tokenSeq = 0;

  return {
    users,
    refreshTokens,
    db: {
      user: {
        findUnique: vi.fn(
          async ({ where }: { where: { id?: string; username?: string } }) =>
            users.find(
              (user) =>
                user.id === where.id ||
                user.username === where.username ||
                user.email === (where as { email?: string }).email,
            ) ?? null,
        ),
        create: vi.fn(
          async ({
            data,
            select,
          }: {
            data: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            const user: Row = {
              id: data.id ?? `user-${++userSeq}`,
              failedLoginCount: 0,
              lockedUntil: null,
              lastFailedLoginAt: null,
              ...data,
            };
            users.push(user);
            if (!select) return user;
            return Object.fromEntries(
              Object.keys(select).map((key) => [key, user[key]]),
            );
          },
        ),
        update: vi.fn(
          async ({
            where,
            data,
            select,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            const user = users.find((item) => item.id === where.id);
            if (!user) throw new Error("User not found");
            Object.assign(user, data);
            if (!select) return user;
            return Object.fromEntries(
              Object.keys(select).map((key) => [key, user[key]]),
            );
          },
        ),
      },
      refreshToken: {
        create: vi.fn(
          async ({
            data,
            select,
          }: {
            data: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            const token: Row = {
              id: `rt-${++tokenSeq}`,
              createdAt: new Date(),
              ...data,
            };
            refreshTokens.push(token);
            if (!select) return token;
            return Object.fromEntries(
              Object.keys(select).map((key) => [key, token[key]]),
            );
          },
        ),
        findUnique: vi.fn(
          async ({
            where,
            include,
          }: {
            where: { tokenHash: string };
            include?: { user?: unknown };
          }) => {
            const token = refreshTokens.find(
              (item) => item.tokenHash === where.tokenHash,
            );
            if (!token) return null;
            if (!include?.user) return token;
            return {
              ...token,
              user: users.find((user) => user.id === token.userId),
            };
          },
        ),
        update: vi.fn(
          async ({
            where,
            data,
            select,
          }: {
            where: { id: string };
            data: Record<string, unknown>;
            select?: Record<string, boolean>;
          }) => {
            const token = refreshTokens.find((item) => item.id === where.id);
            if (!token) throw new Error("Refresh token not found");
            Object.assign(token, data);
            if (!select) return token;
            return Object.fromEntries(
              Object.keys(select).map((key) => [key, token[key]]),
            );
          },
        ),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback((undefined as unknown as { db: unknown }).db ?? undefined),
      ),
    },
  };
}

describe("auth-service", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
    vi.clearAllMocks();
  });

  async function seedActiveUser(
    db: ReturnType<typeof createDb>["db"],
    input: {
      username: string;
      email: string;
      role: "SUPERADMIN" | "ADMIN" | "SALES";
      group: string;
    },
  ) {
    return db.user.create({
      data: {
        ...input,
        password: await hashPassword("Password123!"),
      },
    });
  }

  it("disables public self-registration", async () => {
    const { db } = createDb();

    await expect(
      register(db as never, {
        email: "sa-a@mail.shangjung.com",
        password: "Password123!",
        role: "SUPERADMIN",
        group: "A",
      }),
    ).rejects.toThrow(SelfRegistrationDisabledError);
  });

  it("logs in by username or email, stores a hashed refresh token, and returns a verifiable access token", async () => {
    const { db, refreshTokens } = createDb();
    await seedActiveUser(db, {
      username: "admin-A1",
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });

    const result = await login(db as never, {
      username: "admin-A1",
      password: "Password123!",
    });

    await expect(verifyAccessToken(result.accessToken)).resolves.toMatchObject({
      sub: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sid: "session-user-1",
    });
    expect(result.refreshToken).toBeTypeOf("string");
    expect(refreshTokens[0].tokenHash).toBe(
      hashRefreshToken(result.refreshToken),
    );
    expect(refreshTokens[0].sessionId).toBe("session-user-1");
    expect(createAuthSession).toHaveBeenCalledWith(
      {
        id: "user-1",
        role: "ADMIN",
        username: "admin-A1",
      },
      expect.any(Date),
    );

    await expect(
      login(db as never, {
        username: "admin-a1@mail.shangjung.com",
        password: "Password123!",
      }),
    ).resolves.toMatchObject({
      user: {
        username: "admin-A1",
        email: "admin-a1@mail.shangjung.com",
      },
    });
  });

  it("locks an account for 15 minutes after 5 failed login attempts", async () => {
    const { db, users } = createDb();
    await seedActiveUser(db, {
      username: "sales-1",
      email: "sales-a@mail.shangjung.com",
      role: "SALES",
      group: "A",
    });

    for (let i = 0; i < 4; i++) {
      await expect(
        login(db as never, {
          username: "sales-1",
          password: "wrong-password",
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    }

    await expect(
      login(db as never, {
        username: "sales-1",
        password: "wrong-password",
      }),
    ).rejects.toThrow(AccountLockedError);

    expect(users[0].failedLoginCount).toBe(5);
    expect(users[0].lockedUntil).toBeInstanceOf(Date);
  });

  it("rotates refresh tokens and rejects reused or logged-out tokens", async () => {
    const { db } = createDb();
    await seedActiveUser(db, {
      username: "admin-A1",
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });
    const loginResult = await login(db as never, {
      username: "admin-A1",
      password: "Password123!",
    });

    const refreshed = await refresh(db as never, {
      refreshToken: loginResult.refreshToken,
    });

    expect(refreshed.refreshToken).not.toBe(loginResult.refreshToken);
    expect(getAuthSession).toHaveBeenCalledWith("session-user-1");
    expect(touchAuthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-user-1",
        userId: "user-1",
      }),
      expect.any(Date),
    );
    await expect(
      verifyAccessToken(refreshed.accessToken),
    ).resolves.toMatchObject({
      sid: "session-user-1",
    });
    await expect(
      refresh(db as never, {
        refreshToken: loginResult.refreshToken,
      }),
    ).rejects.toThrow(InvalidRefreshTokenError);

    await logout(db as never, { refreshToken: refreshed.refreshToken });
    expect(deleteAuthSession).toHaveBeenCalledWith("session-user-1");
    await expect(
      refresh(db as never, {
        refreshToken: refreshed.refreshToken,
      }),
    ).rejects.toThrow(InvalidRefreshTokenError);
  });

  it("rejects refresh tokens that do not belong to a Redis server session", async () => {
    const { db, refreshTokens } = createDb();
    await seedActiveUser(db, {
      username: "admin-A1",
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });
    const loginResult = await login(db as never, {
      username: "admin-A1",
      password: "Password123!",
    });
    refreshTokens[0].sessionId = null;

    await expect(
      refresh(db as never, {
        refreshToken: loginResult.refreshToken,
      }),
    ).rejects.toThrow(InvalidRefreshTokenError);
  });

  it("rejects refresh tokens when the Redis server session is gone", async () => {
    const { db } = createDb();
    await seedActiveUser(db, {
      username: "admin-A1",
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });
    const loginResult = await login(db as never, {
      username: "admin-A1",
      password: "Password123!",
    });
    vi.mocked(getAuthSession).mockResolvedValueOnce(null);

    await expect(
      refresh(db as never, {
        refreshToken: loginResult.refreshToken,
      }),
    ).rejects.toThrow(InvalidRefreshTokenError);
  });
});

describe("logout (direct mock)", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
    vi.clearAllMocks();
  });

  function makeDb(token: Record<string, unknown> | null) {
    return {
      refreshToken: {
        findUnique: vi.fn().mockResolvedValue(token),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Parameters<typeof logout>[0];
  }

  const NOW = new Date("2026-06-03T10:00:00.000Z");

  it("returns ok:true when the token does not exist in the DB", async () => {
    const result = await logout(
      makeDb(null),
      { refreshToken: "no-token" },
      NOW,
    );
    expect(result).toEqual({ ok: true });
    expect(deleteAuthSession).not.toHaveBeenCalled();
  });

  it("revokes a valid active token and deletes the Redis session", async () => {
    const token = {
      id: "rt-1",
      sessionId: "sess-1",
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
    const db = makeDb(token);
    const result = await logout(db, { refreshToken: "valid-token" }, NOW);
    expect(result).toEqual({ ok: true });
    expect(db.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rt-1" } }),
    );
    expect(deleteAuthSession).toHaveBeenCalledWith("sess-1");
  });

  it("skips deleteAuthSession when sessionId is null", async () => {
    const token = {
      id: "rt-1",
      sessionId: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
    await logout(makeDb(token), { refreshToken: "t" }, NOW);
    expect(deleteAuthSession).not.toHaveBeenCalled();
  });

  it("returns ok:true without revoking when token is already revoked", async () => {
    const token = {
      id: "rt-1",
      sessionId: "sess-1",
      revokedAt: new Date(NOW.getTime() - 5000),
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
    const db = makeDb(token);
    const result = await logout(db, { refreshToken: "t" }, NOW);
    expect(result).toEqual({ ok: true });
    expect(db.refreshToken.update).not.toHaveBeenCalled();
  });

  it("returns ok:true without revoking when token is expired", async () => {
    const token = {
      id: "rt-1",
      sessionId: "sess-1",
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() - 5000),
    };
    const db = makeDb(token);
    const result = await logout(db, { refreshToken: "t" }, NOW);
    expect(result).toEqual({ ok: true });
    expect(db.refreshToken.update).not.toHaveBeenCalled();
  });
});
