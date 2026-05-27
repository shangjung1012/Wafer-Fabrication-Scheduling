import { beforeEach, describe, expect, it } from "vitest";
import {
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
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
