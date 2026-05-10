/**
 * app/api/requests/route.ts
 *
 * GET  /api/requests   — list requests (scope derived from role inside service)
 * POST /api/requests   — create a new request (SALES only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import {
  ForbiddenError,
  forbiddenResponse,
  unauthorizedResponse,
  badRequestResponse,
  notFoundResponse,
} from "@/modules/auth/rbac";
import { listRequests, createRequestService } from "@/modules/order/request-service";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const CreateRequestBodySchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
  message: z.string().min(1, "message is required"),
  payload: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/requests
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const requests = await listRequests(ctx, prisma, {});
    return NextResponse.json(requests);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// POST /api/requests
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = CreateRequestBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>
      );
    }

    const request = await createRequestService(ctx, prisma, parsed.data);
    return NextResponse.json(request, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}
