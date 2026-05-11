import { createHash, randomBytes } from "crypto";
import type { PrismaClient, UserRole } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";
import { hashPassword } from "@/modules/auth/password-service";
import { requireRole } from "@/modules/auth/rbac";
import { sendMail } from "@/modules/mail/mail-service";

const INVITATION_TTL_MS = 180 * 1000;

type InvitationUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  group: string | null;
};

export type InvitationPreview = InvitationUser & {
  expiresAt: Date;
};

export type CreateInvitationInput = {
  email: string;
  name: string;
  role: UserRole;
  group: string;
  origin: string;
};

export type CreateInvitationResult = InvitationUser & {
  invitationExpiresAt: Date;
};

export type AcceptInvitationInput = {
  token: string;
  accountId: string;
  password: string;
};

export class InvitationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "InvitationError";
    this.status = status;
    this.code = code;
  }
}

function issueInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function invitationExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + INVITATION_TTL_MS);
}

function setPasswordUrl(origin: string, token: string): string {
  const url = new URL("/set-password", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function sendInvitationMail(
  user: InvitationUser,
  token: string,
  origin: string,
): Promise<void> {
  const link = setPasswordUrl(origin, token);
  await sendMail({
    to: [{ address: user.email, displayName: user.name }],
    subject: "Set your Wafer Scheduling password",
    plainText: [
      `Hello ${user.name},`,
      "",
      "You have been invited to Wafer Scheduling.",
      "Use this link to set your account ID and password within 180 seconds:",
      link,
      "",
      "If the link expires, ask your superadmin to resend the invitation.",
    ].join("\n"),
    html: [
      `<p>Hello ${user.name},</p>`,
      "<p>You have been invited to Wafer Scheduling.</p>",
      `<p><a href="${link}">Set your account ID and password</a></p>`,
      "<p>This link expires in 180 seconds. If it expires, ask your superadmin to resend the invitation.</p>",
    ].join(""),
  });
}

function assertActiveInvitation(
  invitation: {
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  } | null,
  now: Date,
): void {
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt.getTime() <= now.getTime()
  ) {
    throw new InvitationError(
      400,
      "INVALID_INVITATION",
      "Invitation is invalid or expired.",
    );
  }
}

export async function createUserInvitation(
  ctx: RequestContext,
  db: PrismaClient,
  input: CreateInvitationInput,
  now = new Date(),
): Promise<CreateInvitationResult> {
  requireRole(ctx, ["SUPERADMIN"]);

  const existingEmail = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingEmail) {
    throw new InvitationError(409, "USER_EXISTS", "Email is already in use.");
  }

  const token = issueInvitationToken();
  const expiresAt = invitationExpiresAt(now);

  const user = await db.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        accountId: null,
        email: input.email,
        name: input.name,
        password: null,
        role: input.role,
        group: input.group,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        group: true,
      },
    });

    await tx.userInvitation.create({
      data: {
        userId: createdUser.id,
        createdById: ctx.user.id,
        tokenHash: hashInvitationToken(token),
        expiresAt,
      },
      select: { id: true },
    });

    return createdUser;
  });

  await sendInvitationMail(user, token, input.origin);

  return {
    ...user,
    invitationExpiresAt: expiresAt,
  };
}

export async function resendUserInvitation(
  ctx: RequestContext,
  db: PrismaClient,
  userId: string,
  origin: string,
  now = new Date(),
): Promise<CreateInvitationResult> {
  requireRole(ctx, ["SUPERADMIN"]);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      group: true,
      password: true,
    },
  });
  if (!user) {
    throw new InvitationError(404, "USER_NOT_FOUND", "User not found.");
  }
  if (user.password) {
    throw new InvitationError(
      409,
      "USER_ALREADY_ACTIVE",
      "User has already set a password.",
    );
  }

  const token = issueInvitationToken();
  const expiresAt = invitationExpiresAt(now);

  await db.$transaction(async (tx) => {
    await tx.userInvitation.updateMany({
      where: {
        userId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await tx.userInvitation.create({
      data: {
        userId,
        createdById: ctx.user.id,
        tokenHash: hashInvitationToken(token),
        expiresAt,
      },
      select: { id: true },
    });
  });

  await sendInvitationMail(user, token, origin);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    group: user.group,
    invitationExpiresAt: expiresAt,
  };
}

export async function verifyInvitation(
  db: PrismaClient,
  token: string,
  now = new Date(),
): Promise<InvitationPreview> {
  const invitation = await db.userInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: {
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          group: true,
        },
      },
    },
  });

  assertActiveInvitation(invitation, now);

  return {
    ...invitation!.user,
    expiresAt: invitation!.expiresAt,
  };
}

export async function acceptInvitation(
  db: PrismaClient,
  input: AcceptInvitationInput,
  now = new Date(),
): Promise<{ ok: true }> {
  const invitation = await db.userInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(input.token) },
    select: {
      id: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      userId: true,
    },
  });

  assertActiveInvitation(invitation, now);

  const existingAccount = await db.user.findUnique({
    where: { accountId: input.accountId },
    select: { id: true },
  });
  if (existingAccount) {
    throw new InvitationError(
      409,
      "ACCOUNT_ID_EXISTS",
      "Account ID is already in use.",
    );
  }

  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: invitation!.userId },
      data: {
        accountId: input.accountId,
        password: passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      },
      select: { id: true },
    });

    await tx.userInvitation.update({
      where: { id: invitation!.id },
      data: { acceptedAt: now },
      select: { id: true },
    });
  });

  return { ok: true };
}
