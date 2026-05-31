import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as refreshPost } from "@/app/api/auth/refresh/route";
import { GET as usersGet } from "@/app/api/users/route";
import {
  DELETE as userDelete,
  PATCH as userPatch,
} from "@/app/api/users/[id]/route";
import { hashPassword } from "@/modules/auth/password-service";

const PASSWORD = "Password123!";
const TEST_USER_IDS = [
  "route-test-sa-A",
  "route-test-admin-A",
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

function cookieHeader(response: Response): string {
  const setCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return setCookie
    .filter(Boolean)
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function authedNextRequest(url: string, cookie?: string): NextRequest {
  return new NextRequest(url, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function authedJsonNextRequest(
  url: string,
  cookie: string,
  method: "PATCH" | "DELETE",
  body?: unknown,
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      Cookie: cookie,
      Origin: "http://localhost",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
        username: "route-test-sa-A",
        email: "route-test-sa-a@mail.shangjung.com",
        password,
        role: "SUPERADMIN",
        group: "A",
      },
      {
        id: "route-test-admin-A",
        username: "route-test-admin-A",
        email: "route-test-admin-a@mail.shangjung.com",
        password,
        role: "ADMIN",
        group: "A",
      },
      {
        id: "route-test-sales-A",
        username: "route-test-sales-A",
        email: "route-test-sales-a@mail.shangjung.com",
        password,
        role: "SALES",
        group: "A",
      },
      {
        id: "route-test-sales-B",
        username: "route-test-sales-B",
        email: "route-test-sales-b@mail.shangjung.com",
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
    process.env.APP_BASE_URL = "http://localhost";
    await cleanupRouteTestUsers();
    await seedRouteTestUsers();
  });

  afterAll(async () => {
    await cleanupRouteTestUsers();
    await prisma.$disconnect();
  });

  it("logs in, sets auth cookies, and authorizes a protected API by role and scope", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        username: "route-test-sa-A",
        password: PASSWORD,
      }),
    );
    expect(loginResponse.status).toBe(200);

    const loginBody = (await loginResponse.json()) as {
      user: { username: string; role: string };
    };
    const cookies = cookieHeader(loginResponse);
    expect(cookies).toContain("access_token=");
    expect(cookies).toContain("refresh_token=");
    expect(loginBody.user).toMatchObject({
      username: "route-test-sa-A",
      role: "SUPERADMIN",
    });

    const usersResponse = await usersGet(
      authedNextRequest("http://localhost/api/users", cookies),
    );
    expect(usersResponse.status).toBe(200);

    const usersBody = (await usersResponse.json()) as {
      items: Array<{ username: string; group: string | null }>;
    };
    expect(usersBody.items.map((user) => user.username)).toEqual(
      expect.arrayContaining(["route-test-sa-A", "route-test-sales-A"]),
    );
    expect(usersBody.items.map((user) => user.username)).not.toContain(
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
        username: "route-test-sales-A",
        password: PASSWORD,
      }),
    );
    const cookies = cookieHeader(loginResponse);

    const response = await usersGet(
      authedNextRequest("http://localhost/api/users", cookies),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows SUPERADMIN to update a user account", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        username: "route-test-sa-A",
        password: PASSWORD,
      }),
    );
    const cookies = cookieHeader(loginResponse);

    const response = await userPatch(
      authedJsonNextRequest(
        "http://localhost/api/users/route-test-sales-A",
        cookies,
        "PATCH",
        {
          username: "route-test-sales-A-renamed",
          email: "route-test-sales-a-renamed@mail.shangjung.com",
          role: "SALES",
          group: "A",
        },
      ),
      { params: Promise.resolve({ id: "route-test-sales-A" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "route-test-sales-A",
    });
    await expect(
      prisma.user.findUnique({
        where: { id: "route-test-sales-A" },
        select: { username: true, email: true, role: true, group: true },
      }),
    ).resolves.toMatchObject({
      username: "route-test-sales-A-renamed",
      email: "route-test-sales-a-renamed@mail.shangjung.com",
      role: "SALES",
      group: "A",
    });
  });

  it("rejects ADMIN account updates and removals", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        username: "route-test-admin-A",
        password: PASSWORD,
      }),
    );
    const cookies = cookieHeader(loginResponse);

    const patchResponse = await userPatch(
      authedJsonNextRequest(
        "http://localhost/api/users/route-test-sales-A",
        cookies,
        "PATCH",
        { email: "route-test-sales-a-renamed@mail.shangjung.com" },
      ),
      { params: Promise.resolve({ id: "route-test-sales-A" }) },
    );
    expect(patchResponse.status).toBe(403);

    const deleteResponse = await userDelete(
      authedJsonNextRequest(
        "http://localhost/api/users/route-test-sales-A",
        cookies,
        "DELETE",
      ),
      { params: Promise.resolve({ id: "route-test-sales-A" }) },
    );
    expect(deleteResponse.status).toBe(403);
  });

  it("allows SUPERADMIN to remove a user account", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        username: "route-test-sa-A",
        password: PASSWORD,
      }),
    );
    const cookies = cookieHeader(loginResponse);

    const response = await userDelete(
      authedJsonNextRequest(
        "http://localhost/api/users/route-test-sales-A",
        cookies,
        "DELETE",
      ),
      { params: Promise.resolve({ id: "route-test-sales-A" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "route-test-sales-A",
    });
    await expect(
      prisma.user.findUnique({ where: { id: "route-test-sales-A" } }),
    ).resolves.toBeNull();
  });

  it("logs out by revoking the refresh token", async () => {
    const loginResponse = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        username: "route-test-sa-A",
        password: PASSWORD,
      }),
    );
    const cookies = cookieHeader(loginResponse);

    const logoutResponse = await logoutPost(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: cookies, Origin: "http://localhost" },
      }),
    );
    expect(logoutResponse.status).toBe(200);
    await expect(logoutResponse.json()).resolves.toEqual({ ok: true });

    const refreshResponse = await refreshPost(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: cookies, Origin: "http://localhost" },
      }),
    );
    expect(refreshResponse.status).toBe(401);
    await expect(refreshResponse.json()).resolves.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });
});
