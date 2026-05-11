import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { refresh } from "@/modules/auth/auth-service";
import {
  authErrorResponse,
  parseJsonError,
  validationErrorResponse,
} from "@/app/api/auth/_shared";

const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required"),
});

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return parseJsonError();
    }

    const parsed = RefreshBodySchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const result = await refresh(prisma, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    const response = authErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
