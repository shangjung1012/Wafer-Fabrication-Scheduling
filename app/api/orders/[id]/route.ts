/**
 * app/api/orders/[id]/route.ts
 *
 * GET /api/orders/[id]  — fetch a single order
 * PUT /api/orders/[id]  — update an order (partial, at least one field required)
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
import { getOrder, updateOrderService } from "@/modules/order/order-service";
import { OrderQuantitySchema } from "@/modules/order/order-validation";
import { OrderStatus } from "@/infra/db/order-repository";
import { prisma } from "@/lib/prisma";
import { getTime } from "@/lib/get-time";
import { isBeforeDateOnly } from "@/lib/date-utils";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UpdateOrderBodySchema = z
  .object({
    status: z.nativeEnum(OrderStatus).optional(),
    dueDate: z.string().datetime().optional(),
    quantity: OrderQuantitySchema.optional(),
    name: z.string().min(1).optional(),
    isFixed: z.boolean().optional(),
    isPrioritized: z.boolean().optional(),
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
    if (err instanceof CsrfError) return csrfResponse(err.message);
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

    if (data.dueDate) {
      if (isBeforeDateOnly(new Date(data.dueDate), await getTime())) {
        return badRequestResponse("Due date cannot be in the past.");
      }
    }

    const order = await updateOrderService(ctx, prisma, id, {
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      isFixed: data.isFixed,
      isPrioritized: data.isPrioritized,
    });
    return NextResponse.json(order);
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
