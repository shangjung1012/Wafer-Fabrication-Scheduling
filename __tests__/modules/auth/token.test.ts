import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  durationToMs,
  accessTokenTtl,
  refreshTokenTtl,
  refreshTokenExpiresAt,
} from "@/modules/auth/token-service";

describe("token-service", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("issues verifiable access JWTs with user identity claims", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      username: "admin-A1",
      sessionId: "session-1",
    });

    const payload = await verifyAccessToken(token);

    expect(payload.sub).toBe("user-1");
    expect(payload.role).toBe("ADMIN");
    expect(payload.username).toBe("admin-A1");
    expect(payload.sid).toBe("session-1");
  });

  it("rejects legacy access JWTs that do not carry a session id", async () => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({
      role: "ADMIN",
      username: "admin-A1",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setIssuer(process.env.JWT_ISSUER || "wafer-auth")
      .setAudience(process.env.JWT_AUDIENCE || "wafer-api")
      .setSubject("user-1")
      .setExpirationTime("15m")
      .sign(
        new TextEncoder().encode(
          process.env.JWT_SECRET ?? "test-secret-at-least-32-characters-long",
        ),
      );

    await expect(verifyAccessToken(token)).rejects.toThrow(
      "Invalid access token payload.",
    );
  });

  it("generates opaque refresh tokens and stable SHA-256 hashes", () => {
    const refreshToken = issueRefreshToken();

    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(hashRefreshToken(refreshToken)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRefreshToken(refreshToken)).toBe(hashRefreshToken(refreshToken));
  });
});

describe("durationToMs", () => {
  it.each([
    ["15s", 15_000],
    ["15m", 15 * 60_000],
    ["2h", 2 * 3_600_000],
    ["7d", 7 * 86_400_000],
  ])("converts %s to %d ms", (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });

  it("throws for invalid format", () => {
    expect(() => durationToMs("bad")).toThrow(/Invalid duration/);
  });
});

describe("ttl helpers", () => {
  afterEach(() => {
    delete process.env.ACCESS_TOKEN_EXPIRES_IN;
    delete process.env.REFRESH_TOKEN_EXPIRES_IN;
  });

  it("accessTokenTtl falls back to default when env var not set", () => {
    delete process.env.ACCESS_TOKEN_EXPIRES_IN;
    expect(accessTokenTtl()).toBeTruthy();
  });

  it("accessTokenTtl returns env var value when set", () => {
    process.env.ACCESS_TOKEN_EXPIRES_IN = "30m";
    expect(accessTokenTtl()).toBe("30m");
  });

  it("refreshTokenTtl returns env var value when set", () => {
    process.env.REFRESH_TOKEN_EXPIRES_IN = "14d";
    expect(refreshTokenTtl()).toBe("14d");
  });

  it("refreshTokenExpiresAt returns a date in the future", () => {
    process.env.REFRESH_TOKEN_EXPIRES_IN = "7d";
    const now = new Date();
    const expires = refreshTokenExpiresAt(now);
    expect(expires.getTime()).toBeGreaterThan(now.getTime());
  });
});
