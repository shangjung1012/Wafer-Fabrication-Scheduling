import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  setex: vi.fn().mockResolvedValue("OK"),
  get: vi.fn(),
  del: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/redis", () => ({ getRedis: () => redis }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REFRESH_TOKEN_EXPIRES_IN = "7d";
});

import {
  createAuthSession,
  getAuthSession,
  touchAuthSession,
  deleteAuthSession,
} from "@/modules/auth/session-store";

const BASE_USER = { id: "u-1", username: "alice", role: "ADMIN" as const };
const FIXED_NOW = new Date("2026-06-03T10:00:00.000Z");

describe("createAuthSession", () => {
  it("stores the session in Redis and returns it with correct shape", async () => {
    const session = await createAuthSession(BASE_USER, FIXED_NOW);
    expect(session.userId).toBe("u-1");
    expect(session.username).toBe("alice");
    expect(session.role).toBe("ADMIN");
    expect(session.createdAt).toBe(FIXED_NOW.toISOString());
    expect(redis.setex).toHaveBeenCalledWith(
      `auth:session:${session.sessionId}`,
      expect.any(Number),
      expect.stringContaining('"userId":"u-1"'),
    );
  });
});

describe("getAuthSession", () => {
  it("returns the session when Redis has valid data", async () => {
    const session = await createAuthSession(BASE_USER, FIXED_NOW);
    redis.get.mockResolvedValue(JSON.stringify(session));
    const result = await getAuthSession(session.sessionId);
    expect(result?.userId).toBe("u-1");
  });

  it("returns null when Redis has no data", async () => {
    redis.get.mockResolvedValue(null);
    expect(await getAuthSession("no-session")).toBeNull();
  });

  it("returns null when stored data fails validation (wrong sessionId)", async () => {
    const session = await createAuthSession(BASE_USER, FIXED_NOW);
    const tampered = { ...session, sessionId: "different-id" };
    redis.get.mockResolvedValue(JSON.stringify(tampered));
    expect(await getAuthSession(session.sessionId)).toBeNull();
  });

  it("returns null when stored value is invalid JSON", async () => {
    redis.get.mockResolvedValue("not-json{{{");
    expect(await getAuthSession("session-1")).toBeNull();
  });

  it("returns null when stored data is missing required fields", async () => {
    redis.get.mockResolvedValue(JSON.stringify({ sessionId: "x" }));
    expect(await getAuthSession("x")).toBeNull();
  });
});

describe("touchAuthSession", () => {
  it("updates expiresAt and stores the updated session", async () => {
    const session = await createAuthSession(BASE_USER, FIXED_NOW);
    redis.setex.mockClear();
    const later = new Date(FIXED_NOW.getTime() + 60_000);
    const updated = await touchAuthSession(session, later);
    expect(updated.expiresAt).not.toBe(session.expiresAt);
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAuthSession", () => {
  it("calls Redis del with the session key", async () => {
    await deleteAuthSession("session-abc");
    expect(redis.del).toHaveBeenCalledWith("auth:session:session-abc");
  });
});
