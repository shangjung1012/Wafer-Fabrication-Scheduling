import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@/lib/generated/prisma/client";
import {
  acceptInvitation,
  createUserInvitation,
  InvitationError,
  resendUserInvitation,
  verifyInvitation,
} from "@/modules/auth/invitation-service";
import { verifyPassword } from "@/modules/auth/password-service";

const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(),
}));

vi.mock("@/modules/mail/mail-service", () => ({
  sendMail,
}));

type Row = Record<string, unknown>;

function project(row: Row, select?: Record<string, unknown>): Row {
  if (!select) return row;
  return Object.fromEntries(
    Object.entries(select).map(([key, value]) => {
      if (typeof value === "object" && value && key === "user") {
        return [
          key,
          project(
            row.user as Row,
            (value as { select: Record<string, unknown> }).select,
          ),
        ];
      }
      return [key, row[key]];
    }),
  );
}

function createDb() {
  const users: Row[] = [
    {
      id: "sa-1",
      accountId: "sa-A",
      email: "sa-a@mail.shangjung.com",
      name: "SuperAdmin A",
      role: "SUPERADMIN",
      group: "A",
      password: "hash",
    },
  ];
  const invitations: Row[] = [];
  let userSeq = 0;
  let invitationSeq = 0;

  const db = {
    user: {
      findUnique: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id?: string; email?: string; accountId?: string };
          select?: Record<string, unknown>;
        }) => {
          const user =
            users.find(
              (item) =>
                item.id === where.id ||
                item.email === where.email ||
                item.accountId === where.accountId,
            ) ?? null;
          return user ? project(user, select) : null;
        },
      ),
      create: vi.fn(
        async ({
          data,
          select,
        }: {
          data: Row;
          select?: Record<string, unknown>;
        }) => {
          const user = {
            id: `user-${++userSeq}`,
            ...data,
          };
          users.push(user);
          return project(user, select);
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
          select,
        }: {
          where: { id: string };
          data: Row;
          select?: Record<string, unknown>;
        }) => {
          const user = users.find((item) => item.id === where.id);
          if (!user) throw new Error("User not found");
          Object.assign(user, data);
          return project(user, select);
        },
      ),
    },
    userInvitation: {
      findUnique: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { tokenHash: string };
          select?: Record<string, unknown>;
        }) => {
          const invitation = invitations.find(
            (item) => item.tokenHash === where.tokenHash,
          );
          if (!invitation) return null;
          const user = users.find((item) => item.id === invitation.userId);
          return project({ ...invitation, user }, select);
        },
      ),
      create: vi.fn(
        async ({
          data,
          select,
        }: {
          data: Row;
          select?: Record<string, unknown>;
        }) => {
          const invitation = {
            id: `invitation-${++invitationSeq}`,
            acceptedAt: null,
            revokedAt: null,
            createdAt: new Date(),
            ...data,
          };
          invitations.push(invitation);
          return project(invitation, select);
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
          select,
        }: {
          where: { id: string };
          data: Row;
          select?: Record<string, unknown>;
        }) => {
          const invitation = invitations.find((item) => item.id === where.id);
          if (!invitation) throw new Error("Invitation not found");
          Object.assign(invitation, data);
          return project(invitation, select);
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { userId: string; acceptedAt: null; revokedAt: null };
          data: Row;
        }) => {
          let count = 0;
          for (const invitation of invitations) {
            if (
              invitation.userId === where.userId &&
              invitation.acceptedAt === null &&
              invitation.revokedAt === null
            ) {
              Object.assign(invitation, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    ),
  };

  return { db, users, invitations };
}

function ctx(role: UserRole = "SUPERADMIN") {
  return {
    requestId: "request-1",
    user: { id: "sa-1", role, accountId: "sa-A" },
  };
}

function lastInvitationToken(): string {
  const input = sendMail.mock.calls.at(-1)?.[0] as {
    plainText: string;
  };
  const match = input.plainText.match(/token=([^\s]+)/);
  if (!match) throw new Error("Missing token in invitation email");
  return decodeURIComponent(match[1]);
}

describe("invitation-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  it("creates a password-null user, stores only a hashed token, and sends an invitation email", async () => {
    const { db, users, invitations } = createDb();

    await expect(
      createUserInvitation(ctx(), db as never, {
        email: "admin-a1@mail.shangjung.com",
        name: "Admin A1",
        role: "ADMIN",
        group: "A",
      }),
    ).resolves.toMatchObject({
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });

    expect(users.at(-1)).toMatchObject({
      accountId: null,
      password: null,
      email: "admin-a1@mail.shangjung.com",
    });
    expect(invitations[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [
          { address: "admin-a1@mail.shangjung.com", displayName: "Admin A1" },
        ],
        plainText: expect.stringContaining("180 seconds"),
      }),
    );
    expect(sendMail.mock.calls[0][0].plainText).toContain(
      "http://localhost:3000/set-password?token=",
    );
  });

  it("rejects non-superadmin invitations", async () => {
    const { db } = createDb();

    await expect(
      createUserInvitation(ctx("ADMIN"), db as never, {
        email: "sales-a@mail.shangjung.com",
        name: "Sales A",
        role: "SALES",
        group: "A",
      }),
    ).rejects.toThrow("Role 'ADMIN' is not allowed");
  });

  it("accepts an invitation once and sets account ID plus hashed password", async () => {
    const { db, users, invitations } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "sales-a@mail.shangjung.com",
      name: "Sales A",
      role: "SALES",
      group: "A",
    });
    const token = lastInvitationToken();

    await expect(
      acceptInvitation(db as never, {
        token,
        accountId: "sales-A",
        password: "Password123!",
      }),
    ).resolves.toEqual({ ok: true });

    const user = users.find(
      (item) => item.email === "sales-a@mail.shangjung.com",
    );
    expect(user?.accountId).toBe("sales-A");
    expect(user?.password).not.toBe("Password123!");
    await expect(
      verifyPassword(String(user?.password), "Password123!"),
    ).resolves.toBe(true);
    expect(invitations[0].acceptedAt).toBeInstanceOf(Date);

    await expect(
      acceptInvitation(db as never, {
        token,
        accountId: "sales-A2",
        password: "Password123!",
      }),
    ).rejects.toThrow(InvitationError);
  });

  it("rejects expired invitations and duplicate account IDs", async () => {
    const { db } = createDb();
    const now = new Date("2026-05-12T00:00:00.000Z");
    await createUserInvitation(
      ctx(),
      db as never,
      {
        email: "sales-a@mail.shangjung.com",
        name: "Sales A",
        role: "SALES",
        group: "A",
      },
      now,
    );
    const token = lastInvitationToken();

    await expect(
      verifyInvitation(db as never, token, new Date(now.getTime() + 181000)),
    ).rejects.toThrow(InvitationError);

    await expect(
      acceptInvitation(db as never, {
        token,
        accountId: "sa-A",
        password: "Password123!",
      }),
    ).rejects.toThrow("Account ID is already in use.");
  });

  it("resends by revoking old invitations and issuing a new token", async () => {
    const { db, invitations, users } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "admin-a1@mail.shangjung.com",
      name: "Admin A1",
      role: "ADMIN",
      group: "A",
    });
    const user = users.find(
      (item) => item.email === "admin-a1@mail.shangjung.com",
    );

    await resendUserInvitation(ctx(), db as never, String(user?.id));

    expect(invitations).toHaveLength(2);
    expect(invitations[0].revokedAt).toBeInstanceOf(Date);
    expect(invitations[1].revokedAt).toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
