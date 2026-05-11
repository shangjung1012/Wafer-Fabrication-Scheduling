/**
 * app/api/requests/[id]/route.ts
 *
 * PUT  /api/requests/[id]   — update a request (message or payload)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import {
  ForbiddenError,
  csrfResponse,
  forbiddenResponse,
  unauthorizedResponse,
  badRequestResponse,
  notFoundResponse,
} from "@/modules/auth/rbac";
import { updateRequestService } from "@/modules/order/request-service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UpdateRequestBodySchema = z
  .object({
    message: z.string().min(1).optional(),
    payload: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// PUT /api/requests/[id]
// ---------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const ctx = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = UpdateRequestBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    if (
      parsed.data.message === undefined &&
      parsed.data.payload === undefined
    ) {
      return badRequestResponse(
        "At least one field (message or payload) must be provided.",
      );
    }

    const request = await updateRequestService(ctx, prisma, id, parsed.data);
    return NextResponse.json(request);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof CsrfError) return csrfResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}
