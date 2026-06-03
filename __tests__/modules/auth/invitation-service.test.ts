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
      username: "sa-A",
      email: "sa-a@mail.shangjung.com",
      role: "SUPERADMIN",
      group: "A",
      password: "hash",
    },
  ];
  const factories: Row[] = [
    { id: "factory-A1", productionType: "A" },
    { id: "factory-A2", productionType: "A" },
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
          where: { id?: string; email?: string; username?: string };
          select?: Record<string, unknown>;
        }) => {
          const user =
            users.find(
              (item) =>
                item.id === where.id ||
                item.email === where.email ||
                item.username === where.username,
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
      delete: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id: string };
          select?: Record<string, unknown>;
        }) => {
          const index = users.findIndex((item) => item.id === where.id);
          if (index === -1) throw new Error("User not found");
          const [deleted] = users.splice(index, 1);
          for (let i = invitations.length - 1; i >= 0; i--) {
            if (invitations[i].userId === where.id) {
              invitations.splice(i, 1);
            }
          }
          return project(deleted, select);
        },
      ),
    },
    factory: {
      findMany: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { productionType?: string };
          select?: Record<string, unknown>;
        }) => {
          return factories
            .filter(
              (item) =>
                !where.productionType ||
                item.productionType === where.productionType,
            )
            .map((item) => project(item, select));
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
      delete: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id: string };
          select?: Record<string, unknown>;
        }) => {
          const index = invitations.findIndex((item) => item.id === where.id);
          if (index === -1) throw new Error("Invitation not found");
          const [deleted] = invitations.splice(index, 1);
          return project(deleted, select);
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: string | { not: string };
            userId?: string;
            acceptedAt: null;
            revokedAt: null;
            expiresAt?: { gt: Date };
          };
          data: Row;
        }) => {
          let count = 0;
          for (const invitation of invitations) {
            const matchesId =
              typeof where.id === "string"
                ? invitation.id === where.id
                : invitation.id !== where.id?.not;
            if (
              (!where.userId || invitation.userId === where.userId) &&
              matchesId &&
              invitation.acceptedAt === null &&
              invitation.revokedAt === null &&
              (!where.expiresAt ||
                (invitation.expiresAt as Date).getTime() >
                  where.expiresAt.gt.getTime())
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
    user: { id: "sa-1", role, username: "sa-A" },
  };
}

function lastInvitationToken(): string {
  const input = sendMail.mock.calls.at(-1)?.[0] as {
    plainText: string;
  };
  const match = /token=([^\s]+)/.exec(input.plainText);
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
        role: "ADMIN",
        group: "A",
      }),
    ).resolves.toMatchObject({
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });

    expect(users.at(-1)).toMatchObject({
      username: null,
      password: null,
      email: "admin-a1@mail.shangjung.com",
    });
    expect(db.factory.findMany).toHaveBeenCalledWith({
      where: { productionType: "A" },
      select: { id: true },
    });
    expect(invitations[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: [{ address: "admin-a1@mail.shangjung.com" }],
        plainText: expect.stringContaining("180 seconds"),
      }),
    );
    expect(sendMail.mock.calls[0][0].plainText).toContain(
      "http://localhost:3000/set-password?token=",
    );
  });

  it("escapes invitation HTML fields", async () => {
    const { db } = createDb();

    await createUserInvitation(ctx(), db as never, {
      email: "admin.a1+test@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });

    const html = sendMail.mock.calls[0][0].html as string;
    expect(html).toContain("admin.a1+test@mail.shangjung.com");
    expect(html).not.toContain('href="<');
  });

  it("rolls back a pending user when invitation email delivery fails", async () => {
    const { db, users, invitations } = createDb();
    sendMail.mockRejectedValueOnce(new Error("mail failed"));

    await expect(
      createUserInvitation(ctx(), db as never, {
        email: "admin-a1@mail.shangjung.com",
        role: "ADMIN",
        group: "A",
      }),
    ).rejects.toThrow("mail failed");

    expect(
      users.find((item) => item.email === "admin-a1@mail.shangjung.com"),
    ).toBeUndefined();
    expect(invitations).toHaveLength(0);
  });

  it("rejects non-superadmin invitations", async () => {
    const { db } = createDb();

    await expect(
      createUserInvitation(ctx("ADMIN"), db as never, {
        email: "sales-a@mail.shangjung.com",
        role: "SALES",
        group: "A",
      }),
    ).rejects.toThrow("Role 'ADMIN' is not allowed");
  });

  it("accepts an invitation once and sets username plus hashed password", async () => {
    const { db, users, invitations } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "sales-a@mail.shangjung.com",
      role: "SALES",
      group: "A",
    });
    const token = lastInvitationToken();

    await expect(
      acceptInvitation(db as never, {
        token,
        username: "sales-1",
        password: "Password123!",
      }),
    ).resolves.toEqual({ ok: true });

    const user = users.find(
      (item) => item.email === "sales-a@mail.shangjung.com",
    );
    expect(user?.username).toBe("sales-1");
    expect(user?.password).not.toBe("Password123!");
    await expect(
      verifyPassword(String(user?.password), "Password123!"),
    ).resolves.toBe(true);
    expect(invitations[0].acceptedAt).toBeInstanceOf(Date);

    await expect(
      acceptInvitation(db as never, {
        token,
        username: "sales-12",
        password: "Password123!",
      }),
    ).rejects.toThrow(InvitationError);
  });

  it("allows only one concurrent accept for the same invitation token", async () => {
    const { db, users } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "sales-a@mail.shangjung.com",
      role: "SALES",
      group: "A",
    });
    const token = lastInvitationToken();

    const results = await Promise.allSettled([
      acceptInvitation(db as never, {
        token,
        username: "sales-1",
        password: "Password123!",
      }),
      acceptInvitation(db as never, {
        token,
        username: "sales-2",
        password: "Password456!",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const user = users.find(
      (item) => item.email === "sales-a@mail.shangjung.com",
    );
    expect(["sales-1", "sales-2"]).toContain(user?.username);
  });

  it("rejects expired invitations and duplicate usernames", async () => {
    const { db } = createDb();
    const now = new Date();
    await createUserInvitation(
      ctx(),
      db as never,
      {
        email: "sales-a@mail.shangjung.com",
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
        username: "sa-A",
        password: "Password123!",
      }),
    ).rejects.toThrow("Username is already in use.");

    await expect(
      acceptInvitation(db as never, {
        token,
        username: "not valid",
        password: "Password123!",
      }),
    ).rejects.toThrow("Username must be 3-32 characters");
  });

  it("resends by revoking old invitations and issuing a new token", async () => {
    const { db, invitations, users } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "admin-a1@mail.shangjung.com",
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

  it("throws USER_NOT_FOUND when resending for a non-existent user", async () => {
    const { db } = createDb();
    await expect(
      resendUserInvitation(ctx(), db as never, "does-not-exist"),
    ).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
  });

  it("throws USER_ALREADY_ACTIVE when resending for a user who already set a password", async () => {
    const { db, users } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });
    const user = users.find((u) => u.email === "admin-a1@mail.shangjung.com");
    // Simulate user having set a password
    if (user) user.password = "hashed";

    await expect(
      resendUserInvitation(ctx(), db as never, String(user?.id)),
    ).rejects.toMatchObject({ status: 409, code: "USER_ALREADY_ACTIVE" });
  });

  it("verifyInvitation returns the invitation preview for a valid token", async () => {
    const { db } = createDb();
    const now = new Date();
    await createUserInvitation(
      ctx(),
      db as never,
      { email: "sales@example.com", role: "SALES", group: "A" },
      now,
    );
    const token = lastInvitationToken();
    const preview = await verifyInvitation(db as never, token, now);
    expect(preview.email).toBe("sales@example.com");
    expect(preview.role).toBe("SALES");
    expect(preview.expiresAt).toBeInstanceOf(Date);
  });

  it("keeps the previous invitation active when resend email delivery fails", async () => {
    const { db, invitations, users } = createDb();
    await createUserInvitation(ctx(), db as never, {
      email: "admin-a1@mail.shangjung.com",
      role: "ADMIN",
      group: "A",
    });
    const user = users.find(
      (item) => item.email === "admin-a1@mail.shangjung.com",
    );
    sendMail.mockRejectedValueOnce(new Error("mail failed"));

    await expect(
      resendUserInvitation(ctx(), db as never, String(user?.id)),
    ).rejects.toThrow("mail failed");

    expect(invitations).toHaveLength(1);
    expect(invitations[0].revokedAt).toBeNull();
  });
});
