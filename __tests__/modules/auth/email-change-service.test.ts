import { describe, expect, it } from "vitest";
import {
  issueEmailChangeToken,
  hashEmailChangeToken,
  emailChangeTokenExpiresAt,
  createEmailChangeToken,
  confirmEmailChangeToken,
  EmailChangeError,
} from "@/modules/auth/email-change-service";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const TTL_MS = 3 * 60 * 1000;

describe("pure helpers", () => {
  it("issueEmailChangeToken produces a base64url string of sufficient length", () => {
    const token = issueEmailChangeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("hashEmailChangeToken produces a stable hex SHA-256", () => {
    const token = issueEmailChangeToken();
    const hash = hashEmailChangeToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashEmailChangeToken(token)).toBe(hash);
  });

  it("emailChangeTokenExpiresAt is ~3 minutes after now", () => {
    const now = new Date("2026-06-03T10:00:00.000Z");
    const expiry = emailChangeTokenExpiresAt(now);
    expect(expiry.getTime() - now.getTime()).toBe(TTL_MS);
  });
});

// ---------------------------------------------------------------------------
// Minimal PrismaClient stubs
// ---------------------------------------------------------------------------

type EmailChangeTokenFns = {
  deleteMany?: () => Promise<{ count: number }>;
  create?: () => Promise<{ id: string }>;
  findUnique?: (args: {
    where: { tokenHash: string };
    select: object;
  }) => Promise<unknown>;
  updateMany?: (args: object) => Promise<{ count: number }>;
};

type UserFns = {
  findUnique?: (args: object) => Promise<unknown>;
  update?: (args: object) => Promise<unknown>;
};

function makeDb(
  emailChangeToken: EmailChangeTokenFns = {},
  user: UserFns = {},
): PrismaClient {
  return {
    emailChangeToken,
    user,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ emailChangeToken, user }),
  } as unknown as PrismaClient;
}

describe("createEmailChangeToken", () => {
  it("deletes existing tokens, creates a new one and returns raw token + expiry", async () => {
    let deletedUserId: string | undefined;
    let createdData: Record<string, unknown> | undefined;

    const db = makeDb({
      deleteMany: async (args: { where: { userId: string } }) => {
        deletedUserId = args.where.userId;
        return { count: 1 };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        createdData = args.data;
        return { id: "row-1" };
      },
    } as unknown as EmailChangeTokenFns);

    const now = new Date("2026-06-03T10:00:00.000Z");
    const { token, expiresAt } = await createEmailChangeToken(
      db,
      { userId: "user-1", newEmail: "new@example.com" },
      now,
    );

    expect(deletedUserId).toBe("user-1");
    expect(token).toBeTruthy();
    expect(expiresAt.getTime()).toBe(now.getTime() + TTL_MS);
    expect(createdData?.userId).toBe("user-1");
    expect(createdData?.newEmail).toBe("new@example.com");
    expect(createdData?.tokenHash).toBe(hashEmailChangeToken(token));
  });
});

describe("confirmEmailChangeToken", () => {
  const now = new Date("2026-06-03T10:00:00.000Z");
  const futureExpiry = new Date(now.getTime() + TTL_MS);

  function validRecord(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "row-1",
      userId: "user-1",
      newEmail: "new@example.com",
      expiresAt: futureExpiry,
      usedAt: null,
      ...overrides,
    };
  }

  it("confirms a valid token and returns the new email", async () => {
    const token = issueEmailChangeToken();
    const tokenHash = hashEmailChangeToken(token);

    const db = makeDb(
      {
        findUnique: async () => validRecord(),
        updateMany: async () => ({ count: 1 }),
      } as unknown as EmailChangeTokenFns,
      {
        findUnique: async () => null,
        update: async () => ({}),
      },
    );

    // Override $transaction to call fn with the full db stubs
    (db as unknown as { $transaction: unknown }).$transaction = async (
      fn: (tx: unknown) => Promise<unknown>,
    ) => {
      return fn({
        emailChangeToken: {
          updateMany: async () => ({ count: 1 }),
        },
        user: {
          update: async () => ({}),
        },
      });
    };

    const result = await confirmEmailChangeToken(
      db,
      { userId: "user-1", token },
      now,
    );
    expect(result.email).toBe("new@example.com");
  });

  it("throws EmailChangeError when token record not found", async () => {
    const token = issueEmailChangeToken();
    const db = makeDb({
      findUnique: async () => null,
    } as unknown as EmailChangeTokenFns);

    await expect(
      confirmEmailChangeToken(db, { userId: "user-1", token }, now),
    ).rejects.toThrow(EmailChangeError);
  });

  it("throws EmailChangeError when token belongs to a different user", async () => {
    const token = issueEmailChangeToken();
    const db = makeDb({
      findUnique: async () => validRecord({ userId: "other-user" }),
    } as unknown as EmailChangeTokenFns);

    await expect(
      confirmEmailChangeToken(db, { userId: "user-1", token }, now),
    ).rejects.toThrow(EmailChangeError);
  });

  it("throws EMAIL_CHANGE_TOKEN_USED when token already used", async () => {
    const token = issueEmailChangeToken();
    const db = makeDb({
      findUnique: async () => validRecord({ usedAt: new Date() }),
    } as unknown as EmailChangeTokenFns);

    const err = await confirmEmailChangeToken(
      db,
      { userId: "user-1", token },
      now,
    ).catch((e) => e as EmailChangeError);

    expect(err).toBeInstanceOf(EmailChangeError);
    expect(err.code).toBe("EMAIL_CHANGE_TOKEN_USED");
  });

  it("throws EmailChangeError when token is expired", async () => {
    const token = issueEmailChangeToken();
    const pastExpiry = new Date(now.getTime() - 1);
    const db = makeDb({
      findUnique: async () => validRecord({ expiresAt: pastExpiry }),
    } as unknown as EmailChangeTokenFns);

    await expect(
      confirmEmailChangeToken(db, { userId: "user-1", token }, now),
    ).rejects.toThrow(EmailChangeError);
  });

  it("throws EMAIL_TAKEN when new email is already in use by another user", async () => {
    const token = issueEmailChangeToken();
    const db = makeDb(
      {
        findUnique: async () => validRecord(),
        updateMany: async () => ({ count: 1 }),
      } as unknown as EmailChangeTokenFns,
      {
        findUnique: async () => ({ id: "other-user" }),
      },
    );

    const err = await confirmEmailChangeToken(
      db,
      { userId: "user-1", token },
      now,
    ).catch((e) => e as EmailChangeError);

    expect(err).toBeInstanceOf(EmailChangeError);
    expect(err.code).toBe("EMAIL_TAKEN");
  });
});
