import { createHash, randomBytes, randomUUID } from "crypto";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { UserRole } from "@/modules/auth/request-context";

const DEFAULT_ISSUER = "wafer-auth";
const DEFAULT_AUDIENCE = "wafer-api";
const DEFAULT_ACCESS_TOKEN_TTL = "15m";
const DEFAULT_REFRESH_TOKEN_TTL = "7d";

export type AccessTokenUser = {
  id: string;
  role: UserRole;
  username: string;
  sessionId: string;
};

export type VerifiedAccessTokenPayload = JWTPayload & {
  sub: string;
  role: UserRole;
  username: string;
  sid: string;
};

function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export function accessTokenTtl(): string {
  return process.env.ACCESS_TOKEN_EXPIRES_IN || DEFAULT_ACCESS_TOKEN_TTL;
}

export function refreshTokenTtl(): string {
  return process.env.REFRESH_TOKEN_EXPIRES_IN || DEFAULT_REFRESH_TOKEN_TTL;
}

export function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration '${value}'. Use formats like 15m, 7d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60 * 1000;
    case "h":
      return amount * 60 * 60 * 1000;
    case "d":
      return amount * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Invalid duration unit '${unit}'.`);
  }
}

export function refreshTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + durationToMs(refreshTokenTtl()));
}

export async function issueAccessToken(user: AccessTokenUser): Promise<string> {
  return new SignJWT({
    role: user.role,
    username: user.username,
    sid: user.sessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(process.env.JWT_ISSUER || DEFAULT_ISSUER)
    .setAudience(process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE)
    .setSubject(user.id)
    .setJti(randomUUID())
    .setExpirationTime(accessTokenTtl())
    .sign(jwtSecret());
}

export async function verifyAccessToken(
  token: string,
): Promise<VerifiedAccessTokenPayload> {
  const { payload } = await jwtVerify(token, jwtSecret(), {
    issuer: process.env.JWT_ISSUER || DEFAULT_ISSUER,
    audience: process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE,
  });

  if (
    typeof payload.sub !== "string" ||
    (payload.role !== "SUPERADMIN" &&
      payload.role !== "ADMIN" &&
      payload.role !== "SALES") ||
    typeof payload.username !== "string" ||
    typeof payload.sid !== "string" ||
    payload.sid.length === 0
  ) {
    throw new Error("Invalid access token payload.");
  }

  return payload as VerifiedAccessTokenPayload;
}

export function issueRefreshToken(): string {
  return randomBytes(64).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
