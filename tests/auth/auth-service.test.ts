import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountLockedError,
  AuthConflictError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  login,
  logout,
  refresh,
  register,
} from "@/modules/auth/auth-service";
import { hashRefreshToken, verifyAccessToken } from "@/modules/auth/token-service";

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
        findUnique: vi.fn(async ({ where }: { where: { id?: string; accountId?: string } }) =>
          users.find((user) => user.id === where.id || user.accountId === where.accountId) ?? null
        ),
        create: vi.fn(async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const user: Row = {
            id: data.id ?? `user-${++userSeq}`,
            failedLoginCount: 0,
            lockedUntil: null,
            lastFailedLoginAt: null,
            ...data,
          };
          users.push(user);
          if (!select) return user;
          return Object.fromEntries(Object.keys(select).map((key) => [key, user[key]]));
        }),
        update: vi.fn(async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const user = users.find((item) => item.id === where.id);
          if (!user) throw new Error("User not found");
          Object.assign(user, data);
          if (!select) return user;
          return Object.fromEntries(Object.keys(select).map((key) => [key, user[key]]));
        }),
      },
      refreshToken: {
        create: vi.fn(async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const token: Row = { id: `rt-${++tokenSeq}`, createdAt: new Date(), ...data };
          refreshTokens.push(token);
          if (!select) return token;
          return Object.fromEntries(Object.keys(select).map((key) => [key, token[key]]));
        }),
        findUnique: vi.fn(async ({ where, include }: { where: { tokenHash: string }; include?: { user?: unknown } }) => {
          const token = refreshTokens.find((item) => item.tokenHash === where.tokenHash);
          if (!token) return null;
          if (!include?.user) return token;
          return {
            ...token,
            user: users.find((user) => user.id === token.userId),
          };
        }),
        update: vi.fn(async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          const token = refreshTokens.find((item) => item.id === where.id);
          if (!token) throw new Error("Refresh token not found");
          Object.assign(token, data);
          if (!select) return token;
          return Object.fromEntries(Object.keys(select).map((key) => [key, token[key]]));
        }),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback((undefined as unknown as { db: unknown }).db ?? undefined)),
    },
  };
}

describe("auth-service", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("registers ADMIN and SALES users with hashed passwords", async () => {
    const { db, users } = createDb();

    const user = await register(db as never, {
      accountId: "admin-A1",
      name: "Admin A1",
      password: "Password123!",
      role: "ADMIN",
      group: "A",
    });

    expect(user).toEqual({
      id: "user-1",
      accountId: "admin-A1",
      name: "Admin A1",
      role: "ADMIN",
      group: "A",
    });
    expect(users[0].password).not.toBe("Password123!");
    expect(String(users[0].password).startsWith("$argon2id$")).toBe(true);
  });

  it("rejects SUPERADMIN self-registration and duplicate account IDs", async () => {
    const { db } = createDb();

    await expect(register(db as never, {
      accountId: "sa-A",
      name: "Super Admin A",
      password: "Password123!",
      role: "SUPERADMIN",
      group: "A",
    })).rejects.toThrow(AuthConflictError);

    await register(db as never, {
      accountId: "sales-A",
      name: "Sales A",
      password: "Password123!",
      role: "SALES",
      group: "A",
    });

    await expect(register(db as never, {
      accountId: "sales-A",
      name: "Sales A Copy",
      password: "Password123!",
      role: "SALES",
      group: "A",
    })).rejects.toThrow(AuthConflictError);
  });

  it("logs in, stores a hashed refresh token, and returns a verifiable access token", async () => {
    const { db, refreshTokens } = createDb();
    await register(db as never, {
      accountId: "admin-A1",
      name: "Admin A1",
      password: "Password123!",
      role: "ADMIN",
      group: "A",
    });

    const result = await login(db as never, {
      accountId: "admin-A1",
      password: "Password123!",
    });

    await expect(verifyAccessToken(result.accessToken)).resolves.toMatchObject({
      sub: "user-1",
      role: "ADMIN",
      accountId: "admin-A1",
    });
    expect(result.refreshToken).toBeTypeOf("string");
    expect(refreshTokens[0].tokenHash).toBe(hashRefreshToken(result.refreshToken));
  });

  it("locks an account for 15 minutes after 5 failed login attempts", async () => {
    const { db, users } = createDb();
    await register(db as never, {
      accountId: "sales-A",
      name: "Sales A",
      password: "Password123!",
      role: "SALES",
      group: "A",
    });

    for (let i = 0; i < 4; i++) {
      await expect(login(db as never, {
        accountId: "sales-A",
        password: "wrong-password",
      })).rejects.toThrow(InvalidCredentialsError);
    }

    await expect(login(db as never, {
      accountId: "sales-A",
      password: "wrong-password",
    })).rejects.toThrow(AccountLockedError);

    expect(users[0].failedLoginCount).toBe(5);
    expect(users[0].lockedUntil).toBeInstanceOf(Date);
  });

  it("rotates refresh tokens and rejects reused or logged-out tokens", async () => {
    const { db } = createDb();
    await register(db as never, {
      accountId: "admin-A1",
      name: "Admin A1",
      password: "Password123!",
      role: "ADMIN",
      group: "A",
    });
    const loginResult = await login(db as never, {
      accountId: "admin-A1",
      password: "Password123!",
    });

    const refreshed = await refresh(db as never, {
      refreshToken: loginResult.refreshToken,
    });

    expect(refreshed.refreshToken).not.toBe(loginResult.refreshToken);
    await expect(refresh(db as never, {
      refreshToken: loginResult.refreshToken,
    })).rejects.toThrow(InvalidRefreshTokenError);

    await logout(db as never, { refreshToken: refreshed.refreshToken });
    await expect(refresh(db as never, {
      refreshToken: refreshed.refreshToken,
    })).rejects.toThrow(InvalidRefreshTokenError);
  });
});
