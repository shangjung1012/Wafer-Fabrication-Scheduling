import { createHash, randomBytes } from "crypto";
import type { PrismaClient } from "@/lib/generated/prisma/client";

const EMAIL_CHANGE_TOKEN_TTL_MS = 3 * 60 * 1000;

export class EmailChangeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EmailChangeError";
    this.status = status;
    this.code = code;
  }
}

export function issueEmailChangeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashEmailChangeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function emailChangeTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS);
}

export async function createEmailChangeToken(
  db: PrismaClient,
  input: {
    userId: string;
    newEmail: string;
  },
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  await db.emailChangeToken.deleteMany({
    where: { userId: input.userId },
  });

  const token = issueEmailChangeToken();
  const expiresAt = emailChangeTokenExpiresAt(now);
  await db.emailChangeToken.create({
    data: {
      userId: input.userId,
      newEmail: input.newEmail,
      tokenHash: hashEmailChangeToken(token),
      expiresAt,
    },
    select: { id: true },
  });

  return { token, expiresAt };
}

function invalidToken(): never {
  throw new EmailChangeError(
    400,
    "INVALID_EMAIL_CHANGE_TOKEN",
    "Email verification link is invalid or expired.",
  );
}

export async function confirmEmailChangeToken(
  db: PrismaClient,
  input: {
    userId: string;
    token: string;
  },
  now = new Date(),
): Promise<{ email: string }> {
  const record = await db.emailChangeToken.findUnique({
    where: { tokenHash: hashEmailChangeToken(input.token) },
    select: {
      id: true,
      userId: true,
      newEmail: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!record || record.userId !== input.userId) invalidToken();
  if (record.usedAt) {
    throw new EmailChangeError(
      400,
      "EMAIL_CHANGE_TOKEN_USED",
      "Email verification link has already been used.",
    );
  }
  if (record.expiresAt.getTime() <= now.getTime()) invalidToken();

  const conflict = await db.user.findUnique({
    where: { email: record.newEmail },
    select: { id: true },
  });
  if (conflict && conflict.id !== record.userId) {
    await db.emailChangeToken.updateMany({
      where: {
        id: record.id,
        userId: record.userId,
        usedAt: null,
      },
      data: { usedAt: now },
    });
    throw new EmailChangeError(
      409,
      "EMAIL_TAKEN",
      "Email address is already in use.",
    );
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.emailChangeToken.updateMany({
      where: {
        id: record.id,
        userId: input.userId,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) invalidToken();

    await tx.user.update({
      where: { id: input.userId },
      data: { email: record.newEmail },
      select: { id: true },
    });
  });

  return { email: record.newEmail };
}
