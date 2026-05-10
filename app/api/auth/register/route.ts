import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { register } from "@/modules/auth/auth-service";
import { authErrorResponse, parseJsonError, validationErrorResponse } from "@/app/api/auth/_shared";

const RegisterBodySchema = z.object({
  accountId: z.string().trim().min(1, "accountId is required").max(80),
  name: z.string().trim().min(1, "name is required").max(120),
  password: z.string().min(8, "password must be at least 8 characters").max(256),
  role: z.enum(["ADMIN", "SALES"]),
  group: z.string().trim().min(1, "group is required").max(40),
});

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return parseJsonError();
    }

    const parsed = RegisterBodySchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const user = await register(prisma, parsed.data);
    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    const response = authErrorResponse(err);
    if (response) return response;
    throw err;
  }
}
