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
    });

    const payload = await verifyAccessToken(token);

    expect(payload.sub).toBe("user-1");
    expect(payload.role).toBe("ADMIN");
    expect(payload.username).toBe("admin-A1");
  });

  it("generates opaque refresh tokens and stable SHA-256 hashes", () => {
    const refreshToken = issueRefreshToken();

    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(hashRefreshToken(refreshToken)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRefreshToken(refreshToken)).toBe(hashRefreshToken(refreshToken));
  });
});
