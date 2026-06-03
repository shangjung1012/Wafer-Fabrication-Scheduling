import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { UserRole } from "@/lib/generated/prisma/enums";
import { verifyPassword } from "@/modules/auth/password-service";
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  refreshTokenExpiresAt,
} from "@/modules/auth/token-service";
import {
  createAuthSession,
  deleteAuthSession,
  getAuthSession,
  touchAuthSession,
} from "@/modules/auth/session-store";
import { normalizeUsername } from "@/modules/auth/username";

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

export type SanitizedUser = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  group: string | null;
};

type AuthUserRecord = Omit<SanitizedUser, "username"> & {
  username: string | null;
  password: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastFailedLoginAt: Date | null;
};

type RefreshTokenRecord = {
  id: string;
  userId: string;
  sessionId: string | null;
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

  constructor(message = "Invalid username/email or password.") {
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

export class SelfRegistrationDisabledError extends Error {
  readonly status = 403 as const;
  readonly code = "SELF_REGISTRATION_DISABLED" as const;

  constructor(message = "Self registration is disabled.") {
    super(message);
    this.name = "SelfRegistrationDisabledError";
  }
}

export type RegisterInput = {
  email: string;
  password: string;
  role: UserRole;
  group: string;
};

export type LoginInput = {
  username: string;
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
    username: user.username,
    email: user.email,
    role: user.role,
    group: user.group,
  };
}

async function createStoredRefreshToken(
  db: PrismaClient,
  userId: string,
  sessionId: string,
  now = new Date(),
): Promise<string> {
  const refreshToken = issueRefreshToken();
  await db.refreshToken.create({
    data: {
      userId,
      sessionId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt(now),
    },
    select: { id: true },
  });
  return refreshToken;
}

async function issueAuthTokens(
  db: PrismaClient,
  user: SanitizedUser,
  sessionId: string,
  now = new Date(),
): Promise<AuthTokenResult> {
  const [accessToken, refreshToken] = await Promise.all([
    issueAccessToken({
      id: user.id,
      role: user.role,
      username: user.username,
      sessionId,
    }),
    createStoredRefreshToken(db, user.id, sessionId, now),
  ]);

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
  };
}

export async function register(
  _db: PrismaClient,
  _input: RegisterInput,
): Promise<SanitizedUser> {
  throw new SelfRegistrationDisabledError();
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
  const identifier = input.username.trim();
  const isEmailLogin = identifier.includes("@");
  const username = normalizeUsername(identifier);
  const email = identifier.toLowerCase();

  const user = (await db.user.findUnique({
    where: isEmailLogin ? { email } : { username },
    select: {
      id: true,
      username: true,
      email: true,
      password: true,
      role: true,
      group: true,
      failedLoginCount: true,
      lockedUntil: true,
      lastFailedLoginAt: true,
    },
  })) as AuthUserRecord | null;

  const loginUser =
    user ??
    ((await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        password: true,
        role: true,
        group: true,
        failedLoginCount: true,
        lockedUntil: true,
        lastFailedLoginAt: true,
      },
    })) as AuthUserRecord | null);

  if (!loginUser?.password || !loginUser.username) {
    throw new InvalidCredentialsError();
  }

  if (isLocked(loginUser, now)) {
    throw new AccountLockedError();
  }

  const passwordMatches = await verifyPassword(
    loginUser.password,
    input.password,
  );
  if (!passwordMatches) {
    await recordFailedLogin(db, loginUser, now);
    throw new InvalidCredentialsError();
  }

  const sanitized = sanitizeUser({
    ...loginUser,
    username: loginUser.username,
  });
  await db.user.update({
    where: { id: loginUser.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
    },
    select: { id: true },
  });

  const session = await createAuthSession(
    {
      id: sanitized.id,
      role: sanitized.role,
      username: sanitized.username,
    },
    now,
  );

  return issueAuthTokens(db, sanitized, session.sessionId, now);
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
          username: true,
          email: true,
          role: true,
          group: true,
        },
      },
    },
  })) as RefreshTokenRecord | null;

  if (!existing || !refreshTokenUsable(existing, now)) {
    throw new InvalidRefreshTokenError();
  }
  if (!existing.sessionId) {
    throw new InvalidRefreshTokenError();
  }

  const session = await getAuthSession(existing.sessionId);
  if (!session || session.userId !== existing.userId) {
    throw new InvalidRefreshTokenError();
  }

  const nextRefreshToken = issueRefreshToken();
  const next = await db.refreshToken.create({
    data: {
      userId: existing.userId,
      sessionId: existing.sessionId,
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
  await touchAuthSession(session, now);

  return {
    accessToken: await issueAccessToken({
      id: existing.user.id,
      role: existing.user.role,
      username: existing.user.username,
      sessionId: existing.sessionId,
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
      sessionId: true,
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
    if (existing.sessionId) {
      await deleteAuthSession(existing.sessionId).catch((error) => {
        console.error("Failed to delete auth session during logout:", error);
      });
    }
  }

  return { ok: true };
}
