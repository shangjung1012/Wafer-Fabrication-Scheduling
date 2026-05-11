import { NextResponse } from "next/server";
import { z } from "zod";
import {
  parseJsonError,
  validationErrorResponse,
} from "@/app/api/auth/_shared";
import {
  acceptInvitation,
  InvitationError,
} from "@/modules/auth/invitation-service";
import {
  isValidUsername,
  normalizeUsername,
  usernameValidationMessage,
} from "@/modules/auth/username";
import { prisma } from "@/lib/prisma";

const AcceptInvitationBodySchema = z.object({
  token: z.string().min(1, "token is required"),
  username: z
    .string()
    .trim()
    .transform(normalizeUsername)
    .refine(isValidUsername, usernameValidationMessage()),
  password: z
    .string()
    .min(8, "password must be at least 8 characters")
    .max(256),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return parseJsonError();
  }

  const parsed = AcceptInvitationBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const result = await acceptInvitation(prisma, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InvitationError) {
      return NextResponse.json(
        { code: err.code, message: err.message },
        { status: err.status },
      );
    }
    throw err;
  }
}
