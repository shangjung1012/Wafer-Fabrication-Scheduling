import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { badRequestResponse } from "@/modules/auth/rbac";
import {
  InvitationError,
  verifyInvitation,
} from "@/modules/auth/invitation-service";
import { prisma } from "@/lib/prisma";

const VerifyInvitationQuerySchema = z.object({
  token: z.string().min(1, "token is required"),
});

export async function GET(req: NextRequest) {
  const parsed = VerifyInvitationQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return badRequestResponse(
      "Invalid query parameters.",
      parsed.error.flatten().fieldErrors as Record<string, unknown>,
    );
  }

  try {
    const invitation = await verifyInvitation(prisma, parsed.data.token);
    return NextResponse.json(invitation);
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
