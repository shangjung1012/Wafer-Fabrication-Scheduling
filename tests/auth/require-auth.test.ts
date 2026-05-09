import { beforeEach, describe, expect, it } from "vitest";
import { requireAuth } from "@/modules/auth/require-auth";
import { issueAccessToken } from "@/modules/auth/token-service";

describe("requireAuth", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("accepts JWT bearer access tokens", async () => {
    const token = await issueAccessToken({
      id: "user-1",
      role: "ADMIN",
      accountId: "admin-A1",
    });
    const request = new Request("http://localhost/api/users", {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-request-id": "req-1",
      },
    });

    await expect(requireAuth(request)).resolves.toEqual({
      requestId: "req-1",
      user: {
        id: "user-1",
        role: "ADMIN",
        accountId: "admin-A1",
      },
    });
  });
});
