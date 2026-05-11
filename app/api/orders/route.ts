/**
 * app/api/orders/route.ts
 *
 * GET    /api/orders   — list orders (filtered by status, keyword)
 * POST   /api/orders   — create a single order (SALES only)
 * DELETE /api/orders   — soft-delete orders in bulk (ADMIN only, sets status=CANCELLED)
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
import {
  listOrders,
  createOrderService,
  deleteOrdersService,
} from "@/modules/order/order-service";
import { OrderStatus } from "@/infra/db/order-repository";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const ListOrdersQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  keyword: z.string().optional(),
});

const CreateOrderBodySchema = z.object({
  name: z.string().min(1, "name is required"),
  type: z.string().min(1, "type is required"),
  dueDate: z
    .string()
    .datetime({ message: "dueDate must be a valid ISO datetime string" }),
  quantity: z.number().int().positive("quantity must be a positive integer"),
});

const DeleteOrdersBodySchema = z.object({
  ids: z.array(z.string()).min(1, "At least one id is required"),
});

// ---------------------------------------------------------------------------
// GET /api/orders
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    const queryParams = Object.fromEntries(req.nextUrl.searchParams.entries());
    const parsed = ListOrdersQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid query parameters.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    const { status, keyword } = parsed.data;
    const orders = await listOrders(ctx, prisma, { status, keyword });
    return NextResponse.json(orders);
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
// POST /api/orders
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

    const parsed = CreateOrderBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    const order = await createOrderService(ctx, prisma, {
      ...parsed.data,
      dueDate: new Date(parsed.data.dueDate),
    });
    return NextResponse.json(order, { status: 201 });
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
// DELETE /api/orders
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequestResponse("Request body must be valid JSON.");
    }

    const parsed = DeleteOrdersBodySchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse(
        "Invalid request body.",
        parsed.error.flatten().fieldErrors as Record<string, unknown>,
      );
    }

    const result = await deleteOrdersService(ctx, prisma, parsed.data.ids);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError)
      return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError) return forbiddenResponse(err);
    const e = err as { status?: number; code?: string; message?: string };
    if (e.status === 404) return notFoundResponse(e.message);
    throw err;
  }
}
