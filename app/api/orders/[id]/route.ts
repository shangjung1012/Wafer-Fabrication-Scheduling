/**
 * app/api/orders/[id]/route.ts
 *
 * GET /api/orders/[id]  — fetch a single order
 * PUT /api/orders/[id]  — update an order (partial, at least one field required)
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
import { getOrder, updateOrderService } from "@/modules/order/order-service";
import { OrderStatus } from "@/infra/db/order-repository";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UpdateOrderBodySchema = z
  .object({
    status: z.nativeEnum(OrderStatus).optional(),
    dueDate: z.string().datetime().optional(),
    quantity: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// GET /api/orders/[id]
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    const order = await getOrder(ctx, prisma, id);
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PUT /api/orders/[id]
// ---------------------------------------------------------------------------

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireAuth(req);
    const { id } = await params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = UpdateOrderBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    const data = parsed.data;

    // Require at least one field to be present
    const hasField = Object.values(data).some((v) => v !== undefined);
    if (!hasField) {
      return badRequestResponse("At least one field is required.");
    }

    const order = await updateOrderService(ctx, prisma, id, {
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    });
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}
