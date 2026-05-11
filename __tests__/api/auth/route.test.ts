import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { GET as usersGet } from "@/app/api/users/route";
import { hashPassword } from "@/modules/auth/password-service";

const PASSWORD = "Password123!";
const TEST_USER_IDS = [
  "route-test-sa-A",
  "route-test-sales-A",
  "route-test-sales-B",
];

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function authedNextRequest(url: string, accessToken?: string): NextRequest {
  return new NextRequest(url, {
    headers: accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined,
  });
}

async function cleanupRouteTestUsers(): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: TEST_USER_IDS } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: TEST_USER_IDS } },
  });
}

async function seedRouteTestUsers(): Promise<void> {
  const password = await hashPassword(PASSWORD);
  await prisma.user.createMany({
    data: [
      {
        id: "route-test-sa-A",
        accountId: "route-test-sa-A",
        email: "route-test-sa-a@mail.shangjung.com",
        name: "Route Test SuperAdmin A",
        password,
        role: "SUPERADMIN",
        group: "A",
      },
      {
        id: "route-test-sales-A",
        accountId: "route-test-sales-A",
        email: "route-test-sales-a@mail.shangjung.com",
        name: "Route Test Sales A",
        password,
        role: "SALES",
        group: "A",
      },
      {
        id: "route-test-sales-B",
        accountId: "route-test-sales-B",
        email: "route-test-sales-b@mail.shangjung.com",
        name: "Route Test Sales B",
        password,
        role: "SALES",
        group: "B",
      },
    ],
  });
}

describe("auth API route flow", () => {
  beforeEach(async () => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
    await cleanupRouteTestUsers();
    await seedRouteTestUsers();
  });

  afterAll(async () => {
    await cleanupRouteTestUsers();
    await prisma.$disconnect();
  });

  it("logs in, issues bearer tokens, and authorizes a protected API by role and scope", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        accountId: "route-test-sa-A",
        password: PASSWORD,
      }),
    );
    expect(loginResponse.status).toBe(200);

    const loginBody = (await loginResponse.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { accountId: string; role: string };
    };
    expect(loginBody.accessToken).toBeTypeOf("string");
    expect(loginBody.refreshToken).toBeTypeOf("string");
    expect(loginBody.user).toMatchObject({
      accountId: "route-test-sa-A",
      role: "SUPERADMIN",
    });

    const usersResponse = await usersGet(
      authedNextRequest("http://localhost/api/users", loginBody.accessToken),
    );
    expect(usersResponse.status).toBe(200);

    const usersBody = (await usersResponse.json()) as {
      items: Array<{ accountId: string; group: string | null }>;
    };
    expect(usersBody.items.map((user) => user.accountId)).toEqual(
      expect.arrayContaining(["route-test-sa-A", "route-test-sales-A"]),
    );
    expect(usersBody.items.map((user) => user.accountId)).not.toContain(
      "route-test-sales-B",
    );
  });

  it("rejects protected APIs without a bearer token", async () => {
    const response = await usersGet(
      authedNextRequest("http://localhost/api/users"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects protected APIs when the token role lacks permission", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        accountId: "route-test-sales-A",
        password: PASSWORD,
      }),
    );
    const loginBody = (await loginResponse.json()) as { accessToken: string };

    const response = await usersGet(
      authedNextRequest("http://localhost/api/users", loginBody.accessToken),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("logs out by revoking the refresh token", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        accountId: "route-test-sa-A",
        password: PASSWORD,
      }),
    );
    const loginBody = (await loginResponse.json()) as { refreshToken: string };

    const logoutResponse = await logoutPost(
      jsonRequest("http://localhost/api/auth/logout", {
        refreshToken: loginBody.refreshToken,
      }),
    );
    expect(logoutResponse.status).toBe(200);
    await expect(logoutResponse.json()).resolves.toEqual({ ok: true });

    const refreshResponse = await refreshPost(
      jsonRequest("http://localhost/api/auth/refresh", {
        refreshToken: loginBody.refreshToken,
      }),
    );
    expect(refreshResponse.status).toBe(401);
    await expect(refreshResponse.json()).resolves.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });
});
