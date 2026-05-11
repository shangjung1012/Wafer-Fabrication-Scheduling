import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as usersPost } from "@/app/api/users/route";
import { POST as acceptInvitationPost } from "@/app/api/auth/invitations/accept/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { POST as resendInvitationPost } from "@/app/api/users/[id]/invitation/resend/route";
import { hashPassword } from "@/modules/auth/password-service";

const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(),
}));

vi.mock("@/modules/mail/mail-service", () => ({
  sendMail,
}));

const PASSWORD = "Password123!";
const TEST_EMAILS = [
  "route-invite-sa@mail.shangjung.com",
  "route-invite-admin@mail.shangjung.com",
  "route-invite-sales@mail.shangjung.com",
];
const TEST_USER_IDS = ["route-invite-sa", "route-invite-admin"];

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

function authedNextRequest(
  url: string,
  cookie: string,
  body: unknown,
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Origin: "https://wafer.example.com",
    },
    body: JSON.stringify(body),
  });
}

async function login(username: string): Promise<string> {
  const response = await loginPost(
    jsonRequest("http://localhost/api/auth/login", {
      username,
      password: PASSWORD,
    }),
  );
  return cookieHeader(response);
}

function extractInviteToken(): string {
  const input = sendMail.mock.calls.at(-1)?.[0] as { plainText: string };
  const match = input.plainText.match(/token=([^\s]+)/);
  if (!match) throw new Error("Missing token in invitation email");
  return decodeURIComponent(match[1]);
}

async function cleanupRouteInvitationUsers(): Promise<void> {
  await prisma.userInvitation.deleteMany({
    where: {
      OR: [
        { createdById: { in: TEST_USER_IDS } },
        { userId: { in: TEST_USER_IDS } },
        { user: { email: { in: TEST_EMAILS } } },
      ],
    },
  });

  await prisma.user.deleteMany({
    where: {
      OR: [{ id: { in: TEST_USER_IDS } }, { email: { in: TEST_EMAILS } }],
    },
  });
}

async function seedRouteInvitationUsers(): Promise<void> {
  const password = await hashPassword(PASSWORD);
  await prisma.user.createMany({
    data: [
      {
        id: "route-invite-sa",
        username: "route-invite-sa",
        email: "route-invite-sa@mail.shangjung.com",
        password,
        role: "SUPERADMIN",
        group: "A",
      },
      {
        id: "route-invite-admin",
        username: "route-invite-admin",
        email: "route-invite-admin@mail.shangjung.com",
        password,
        role: "ADMIN",
        group: "A",
      },
    ],
  });
}

describe("invitation API routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
    process.env.APP_BASE_URL = "https://wafer.example.com";
    await cleanupRouteInvitationUsers();
    await seedRouteInvitationUsers();
  });

  afterAll(async () => {
    await cleanupRouteInvitationUsers();
    await prisma.$disconnect();
  });

  it("rejects public self-registration", async () => {
    const response = await registerPost(
      jsonRequest("http://localhost/api/auth/register", {}),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "SELF_REGISTRATION_DISABLED",
    });
  });

  it("allows SUPERADMIN to invite and accept a SALES user", async () => {
    const cookies = await login("route-invite-sa");
    const inviteResponse = await usersPost(
      authedNextRequest("http://localhost/api/users", cookies, {
        email: "route-invite-sales@mail.shangjung.com",
        role: "SALES",
        group: "A",
      }),
    );

    expect(inviteResponse.status).toBe(201);
    const inviteBody = (await inviteResponse.json()) as {
      id: string;
      invitationExpiresAt: string;
    };
    expect(inviteBody.id).toBeTypeOf("string");
    expect(inviteBody.invitationExpiresAt).toBeTypeOf("string");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].plainText).toContain(
      "https://wafer.example.com/set-password?token=",
    );
    expect(sendMail.mock.calls[0][0].plainText).not.toContain(
      "http://localhost/set-password",
    );

    const token = extractInviteToken();
    const acceptResponse = await acceptInvitationPost(
      jsonRequest("http://localhost/api/auth/invitations/accept", {
        token,
        username: "route-invite-sales",
        password: PASSWORD,
      }),
    );

    expect(acceptResponse.status).toBe(200);
    await expect(acceptResponse.json()).resolves.toEqual({ ok: true });

    const salesLogin = await loginPost(
      jsonRequest("http://localhost/api/auth/login", {
        username: "route-invite-sales@mail.shangjung.com",
        password: PASSWORD,
      }),
    );
    expect(salesLogin.status).toBe(200);
  });

  it("rejects ADMIN invitations", async () => {
    const cookies = await login("route-invite-admin");
    const response = await usersPost(
      authedNextRequest("http://localhost/api/users", cookies, {
        email: "route-invite-sales@mail.shangjung.com",
        role: "SALES",
        group: "A",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("resends invitations for pending users", async () => {
    const cookies = await login("route-invite-sa");
    const inviteResponse = await usersPost(
      authedNextRequest("http://localhost/api/users", cookies, {
        email: "route-invite-sales@mail.shangjung.com",
        role: "SALES",
        group: "A",
      }),
    );
    const inviteBody = (await inviteResponse.json()) as { id: string };

    const resendResponse = await resendInvitationPost(
      new NextRequest(
        `http://localhost/api/users/${inviteBody.id}/invitation/resend`,
        {
          method: "POST",
          headers: { Cookie: cookies, Origin: "https://wafer.example.com" },
        },
      ),
      { params: Promise.resolve({ id: inviteBody.id }) },
    );

    expect(resendResponse.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
