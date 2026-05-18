import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { applyAssignmentMoves } from "@/modules/schedule/manual-edit-service";

const MoveSchema = z.object({
  assignmentId: z.string().min(1),
  factoryId: z.string().min(1),
  productionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

const BulkMoveSchema = z.object({
  moves: z.array(MoveSchema).min(1),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request);

    if (ctx.user.role !== "SUPERADMIN" && ctx.user.role !== "ADMIN") {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = BulkMoveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "BAD_REQUEST",
          message: "Invalid input",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

    const result = await applyAssignmentMoves(
      prisma,
      parsed.data.moves,
      ctx.user.id,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof CsrfError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    console.error("Error applying assignment moves:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed" },
      { status: 500 },
    );
  }
}
