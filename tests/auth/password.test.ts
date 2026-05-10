import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/modules/auth/password-service";

describe("password-service", () => {
  it("stores passwords as Argon2id PHC hashes and verifies them", async () => {
    const hash = await hashPassword("Password123!");

    expect(hash).not.toBe("Password123!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(hash, "Password123!")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password")).resolves.toBe(false);
  });
});
