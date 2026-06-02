import { createHash, randomBytes } from "crypto";
import type { PrismaClient, UserRole } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";
import { hashPassword } from "@/modules/auth/password-service";
import { requireRole } from "@/modules/auth/rbac";
import {
  isValidUsername,
  normalizeUsername,
  usernameValidationMessage,
} from "@/modules/auth/username";
import { sendMail } from "@/modules/mail/mail-service";

const INVITATION_TTL_MS = 180 * 1000;

type InvitationUser = {
  id: string;
  email: string;
  role: UserRole;
  group: string | null;
};

export type InvitationPreview = InvitationUser & {
  expiresAt: Date;
};

export type CreateInvitationInput = {
  email: string;
  role: UserRole;
  group: string | null;
};

export type CreateInvitationResult = InvitationUser & {
  invitationExpiresAt: Date;
};

export type AcceptInvitationInput = {
  token: string;
  username: string;
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function appBaseUrl(): string {
  const value = process.env.APP_BASE_URL?.trim();
  if (!value) {
    throw new InvitationError(
      500,
      "APP_BASE_URL_MISSING",
      "APP_BASE_URL is required to send invitation emails.",
    );
  }
  return value;
}

async function sendInvitationMail(
  user: InvitationUser,
  token: string,
): Promise<void> {
  const link = setPasswordUrl(appBaseUrl(), token);
  const safeEmail = escapeHtml(user.email);
  const safeLink = escapeHtml(link);
  await sendMail({
    to: [{ address: user.email }],
    subject: "Set your Wafer Scheduling password",
    plainText: [
      `Hello ${user.email},`,
      "",
      "You have been invited to Wafer Scheduling.",
      "Use this link to set your username and password within 180 seconds:",
      link,
      "",
      "If the link expires, ask your superadmin to resend the invitation.",
    ].join("\n"),
    html: [
      `<p>Hello ${safeEmail},</p>`,
      "<p>You have been invited to Wafer Scheduling.</p>",
      `<p><a href="${safeLink}">Set your username and password</a></p>`,
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
        username: null,
        email: input.email,
        password: null,
        role: input.role,
        group: input.group,
      },
      select: {
        id: true,
        email: true,
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

  try {
    await sendInvitationMail(user, token);
  } catch (error) {
    await db.user.delete({
      where: { id: user.id },
      select: { id: true },
    });
    throw error;
  }

  return {
    ...user,
    invitationExpiresAt: expiresAt,
  };
}

export async function resendUserInvitation(
  ctx: RequestContext,
  db: PrismaClient,
  userId: string,
  now = new Date(),
): Promise<CreateInvitationResult> {
  requireRole(ctx, ["SUPERADMIN"]);

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
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

  const invitation = await db.userInvitation.create({
    data: {
      userId,
      createdById: ctx.user.id,
      tokenHash: hashInvitationToken(token),
      expiresAt,
    },
    select: { id: true },
  });

  try {
    await sendInvitationMail(user, token);
  } catch (error) {
    await db.userInvitation.delete({
      where: { id: invitation.id },
      select: { id: true },
    });
    throw error;
  }

  await db.userInvitation.updateMany({
    where: {
      userId,
      id: { not: invitation.id },
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });

  return {
    id: user.id,
    email: user.email,
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
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) {
    throw new InvitationError(
      400,
      "INVALID_USERNAME",
      usernameValidationMessage(),
    );
  }

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

  const existingUsername = await db.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (existingUsername) {
    throw new InvitationError(
      409,
      "USERNAME_EXISTS",
      "Username is already in use.",
    );
  }

  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async (tx) => {
    const claimed = await tx.userInvitation.updateMany({
      where: {
        id: invitation!.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) {
      throw new InvitationError(
        400,
        "INVALID_INVITATION",
        "Invitation is invalid or expired.",
      );
    }

    await tx.user.update({
      where: { id: invitation!.userId },
      data: {
        username,
        password: passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      },
      select: { id: true },
    });
  });

  return { ok: true };
}
