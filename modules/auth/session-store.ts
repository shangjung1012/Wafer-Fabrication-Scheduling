import { randomUUID } from "crypto";
import { getRedis } from "@/lib/redis";
import {
  durationToMs,
  refreshTokenTtl,
  type AccessTokenUser,
} from "@/modules/auth/token-service";

export type AuthSession = {
  sessionId: string;
  userId: string;
  username: string;
  role: AccessTokenUser["role"];
  createdAt: string;
  expiresAt: string;
};

type AuthSessionUser = Omit<AccessTokenUser, "sessionId">;

function sessionKey(sessionId: string): string {
  return `auth:session:${sessionId}`;
}

function sessionTtlSeconds(): number {
  return Math.floor(durationToMs(refreshTokenTtl()) / 1000);
}

function sessionExpiresAt(now: Date): Date {
  return new Date(now.getTime() + durationToMs(refreshTokenTtl()));
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return (
    typeof session.sessionId === "string" &&
    typeof session.userId === "string" &&
    typeof session.username === "string" &&
    (session.role === "SUPERADMIN" ||
      session.role === "ADMIN" ||
      session.role === "SALES" ||
      session.role === "SYSTEM") &&
    typeof session.createdAt === "string" &&
    typeof session.expiresAt === "string"
  );
}

export async function createAuthSession(
  user: AuthSessionUser,
  now = new Date(),
): Promise<AuthSession> {
  const session: AuthSession = {
    sessionId: randomUUID(),
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: now.toISOString(),
    expiresAt: sessionExpiresAt(now).toISOString(),
  };

  await getRedis().setex(
    sessionKey(session.sessionId),
    sessionTtlSeconds(),
    JSON.stringify(session),
  );

  return session;
}

export async function getAuthSession(
  sessionId: string,
): Promise<AuthSession | null> {
  const raw = await getRedis().get(sessionKey(sessionId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthSession(parsed) || parsed.sessionId !== sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function touchAuthSession(
  session: AuthSession,
  now = new Date(),
): Promise<AuthSession> {
  const nextSession: AuthSession = {
    ...session,
    expiresAt: sessionExpiresAt(now).toISOString(),
  };

  await getRedis().setex(
    sessionKey(session.sessionId),
    sessionTtlSeconds(),
    JSON.stringify(nextSession),
  );

  return nextSession;
}

export async function deleteAuthSession(sessionId: string): Promise<void> {
  await getRedis().del(sessionKey(sessionId));
}
