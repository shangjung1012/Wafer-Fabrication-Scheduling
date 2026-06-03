import { describe, expect, it } from "vitest";
import {
  normalizeUsername,
  isValidUsername,
  usernameValidationMessage,
} from "@/modules/auth/username";

describe("username utils", () => {
  describe("normalizeUsername", () => {
    it("trims leading and trailing whitespace", () => {
      expect(normalizeUsername("  alice  ")).toBe("alice");
      expect(normalizeUsername("bob")).toBe("bob");
    });
  });

  describe("isValidUsername", () => {
    it("accepts valid usernames", () => {
      expect(isValidUsername("alice")).toBe(true);
      expect(isValidUsername("alice123")).toBe(true);
      expect(isValidUsername("alice.bob")).toBe(true);
      expect(isValidUsername("alice_bob")).toBe(true);
      expect(isValidUsername("alice-bob")).toBe(true);
      expect(isValidUsername("a1b")).toBe(true);
    });

    it("rejects usernames that contain @", () => {
      expect(isValidUsername("alice@example.com")).toBe(false);
    });

    it("rejects usernames shorter than 3 characters", () => {
      expect(isValidUsername("a")).toBe(false);
    });

    it("rejects usernames that start or end with special characters", () => {
      expect(isValidUsername(".alice")).toBe(false);
      expect(isValidUsername("alice.")).toBe(false);
      expect(isValidUsername("-alice")).toBe(false);
      expect(isValidUsername("alice-")).toBe(false);
    });

    it("rejects usernames longer than 32 characters", () => {
      // 33 chars: starts/ends with letter, 31 in the middle
      expect(isValidUsername("a" + "b".repeat(31) + "c")).toBe(false);
    });

    it("trims whitespace before validation", () => {
      expect(isValidUsername("  alice  ")).toBe(true);
    });
  });

  describe("usernameValidationMessage", () => {
    it("returns a non-empty guidance string", () => {
      const msg = usernameValidationMessage();
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    });
  });
});
