import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { login } from "@/modules/auth/auth-service";
import { setAuthCookies } from "@/app/api/auth/_cookies";
import {
  authErrorResponse,
  parseJsonError,
  validationErrorResponse,
} from "@/app/api/auth/_shared";

const LoginBodySchema = z.object({
  username: z.string().trim().min(1, "username is required").max(320),
  password: z.string().min(1, "password is required").max(256),
});

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return parseJsonError();
    }

    const parsed = LoginBodySchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const result = await login(prisma, parsed.data);
    const response = NextResponse.json({ user: result.user });
    setAuthCookies(response, result);
    return response;
  } catch (err) {
    const response = authErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
