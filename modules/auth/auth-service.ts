import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { hashPassword, verifyPassword } from "@/modules/auth/password-service";
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  refreshTokenExpiresAt,
} from "@/modules/auth/token-service";

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

export type SanitizedUser = {
  id: string;
  accountId: string;
  name: string;
  role: UserRole;
  group: string | null;
};

type AuthUserRecord = SanitizedUser & {
  password: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastFailedLoginAt: Date | null;
};

type RefreshTokenRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: SanitizedUser;
};

export class AuthConflictError extends Error {
  readonly status = 409 as const;
  readonly code = "AUTH_CONFLICT" as const;

  constructor(message = "Account already exists or is not allowed.") {
    super(message);
    this.name = "AuthConflictError";
  }
}

export class InvalidCredentialsError extends Error {
  readonly status = 401 as const;
  readonly code = "INVALID_CREDENTIALS" as const;

  constructor(message = "Invalid account ID or password.") {
    super(message);
    this.name = "InvalidCredentialsError";
  }
}

export class AccountLockedError extends Error {
  readonly status = 423 as const;
  readonly code = "ACCOUNT_LOCKED" as const;

  constructor(message = "Account is temporarily locked. Try again later.") {
    super(message);
    this.name = "AccountLockedError";
  }
}

export class InvalidRefreshTokenError extends Error {
  readonly status = 401 as const;
  readonly code = "INVALID_REFRESH_TOKEN" as const;

  constructor(message = "Refresh token is invalid or expired.") {
    super(message);
    this.name = "InvalidRefreshTokenError";
  }
}

export type RegisterInput = {
  accountId: string;
  name: string;
  password: string;
  role: UserRole;
  group: string;
};

export type LoginInput = {
  accountId: string;
  password: string;
};

export type RefreshInput = {
  refreshToken: string;
};

export type LogoutInput = {
  refreshToken: string;
};

export type AuthTokenResult = {
  accessToken: string;
  refreshToken: string;
  user: SanitizedUser;
};

function sanitizeUser(user: SanitizedUser): SanitizedUser {
  return {
    id: user.id,
    accountId: user.accountId,
    name: user.name,
    role: user.role,
    group: user.group,
  };
}

async function createStoredRefreshToken(
  db: PrismaClient,
  userId: string,
): Promise<string> {
  const refreshToken = issueRefreshToken();
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt(),
    },
    select: { id: true },
  });
  return refreshToken;
}

async function issueAuthTokens(
  db: PrismaClient,
  user: SanitizedUser,
): Promise<AuthTokenResult> {
  const [accessToken, refreshToken] = await Promise.all([
    issueAccessToken({
      id: user.id,
      role: user.role,
      accountId: user.accountId,
    }),
    createStoredRefreshToken(db, user.id),
  ]);

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
  };
}

export async function register(
  db: PrismaClient,
  input: RegisterInput,
): Promise<SanitizedUser> {
  if (input.role === "SUPERADMIN") {
    throw new AuthConflictError("SUPERADMIN cannot self-register.");
  }

  const exists = await db.user.findUnique({
    where: { accountId: input.accountId },
    select: { id: true },
  });
  if (exists) {
    throw new AuthConflictError("Account ID is already registered.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await db.user.create({
    data: {
      accountId: input.accountId,
      name: input.name,
      password: passwordHash,
      role: input.role,
      group: input.group,
    },
    select: {
      id: true,
      accountId: true,
      name: true,
      role: true,
      group: true,
    },
  });

  return sanitizeUser(user);
}

function isLocked(
  user: Pick<AuthUserRecord, "lockedUntil">,
  now: Date,
): boolean {
  return !!user.lockedUntil && user.lockedUntil.getTime() > now.getTime();
}

async function recordFailedLogin(
  db: PrismaClient,
  user: AuthUserRecord,
  now: Date,
): Promise<void> {
  const failedLoginCount = user.failedLoginCount + 1;
  const lockedUntil =
    failedLoginCount >= LOGIN_LOCK_THRESHOLD
      ? new Date(now.getTime() + LOGIN_LOCK_MS)
      : null;

  await db.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount,
      lockedUntil,
      lastFailedLoginAt: now,
    },
    select: { id: true },
  });

  if (lockedUntil) {
    throw new AccountLockedError();
  }
}

export async function login(
  db: PrismaClient,
  input: LoginInput,
  now = new Date(),
): Promise<AuthTokenResult> {
  const user = (await db.user.findUnique({
    where: { accountId: input.accountId },
    select: {
      id: true,
      accountId: true,
      name: true,
      password: true,
      role: true,
      group: true,
      failedLoginCount: true,
      lockedUntil: true,
      lastFailedLoginAt: true,
    },
  })) as AuthUserRecord | null;

  if (!user?.password) {
    throw new InvalidCredentialsError();
  }

  if (isLocked(user, now)) {
    throw new AccountLockedError();
  }

  const passwordMatches = await verifyPassword(user.password, input.password);
  if (!passwordMatches) {
    await recordFailedLogin(db, user, now);
    throw new InvalidCredentialsError();
  }

  const sanitized = sanitizeUser(user);
  await db.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
    },
    select: { id: true },
  });

  return issueAuthTokens(db, sanitized);
}

function refreshTokenUsable(token: RefreshTokenRecord, now: Date): boolean {
  return !token.revokedAt && token.expiresAt.getTime() > now.getTime();
}

export async function refresh(
  db: PrismaClient,
  input: RefreshInput,
  now = new Date(),
): Promise<AuthTokenResult> {
  const existing = (await db.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(input.refreshToken) },
    include: {
      user: {
        select: {
          id: true,
          accountId: true,
          name: true,
          role: true,
          group: true,
        },
      },
    },
  })) as RefreshTokenRecord | null;

  if (!existing || !refreshTokenUsable(existing, now)) {
    throw new InvalidRefreshTokenError();
  }

  const nextRefreshToken = issueRefreshToken();
  const next = await db.refreshToken.create({
    data: {
      userId: existing.userId,
      tokenHash: hashRefreshToken(nextRefreshToken),
      expiresAt: refreshTokenExpiresAt(now),
    },
    select: { id: true },
  });

  await db.refreshToken.update({
    where: { id: existing.id },
    data: {
      revokedAt: now,
      replacedByTokenId: next.id,
    },
    select: { id: true },
  });

  return {
    accessToken: await issueAccessToken({
      id: existing.user.id,
      role: existing.user.role,
      accountId: existing.user.accountId,
    }),
    refreshToken: nextRefreshToken,
    user: sanitizeUser(existing.user),
  };
}

export async function logout(
  db: PrismaClient,
  input: LogoutInput,
  now = new Date(),
): Promise<{ ok: true }> {
  const existing = await db.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(input.refreshToken) },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
    },
  });

  if (
    existing &&
    !existing.revokedAt &&
    existing.expiresAt.getTime() > now.getTime()
  ) {
    await db.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now },
      select: { id: true },
    });
  }

  return { ok: true };
}
