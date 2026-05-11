/**
 * app/api/orders/import/route.ts
 *
 * POST /api/orders/import  — bulk import orders from a CSV file (ADMIN only)
 *
 * Expected CSV columns: name, type, dueDate, quantity
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
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
  requireRole,
} from "@/modules/auth/rbac";
import { createOrder } from "@/infra/db/order-repository";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// POST /api/orders/import
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    requireRole(ctx, ["ADMIN", "SUPERADMIN"]);

    const form = await req.formData();
    const file = form.get("file");

    if (!file) {
      return badRequestResponse("No file uploaded.");
    }

    const text = await (file as File).text();

    const { data: rows } = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });

    const successes: unknown[] = [];
    const errorList: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // 1-based, +1 for header row

      const { name, type, dueDate, quantity: quantityRaw } = row;

      // Validate required fields
      if (!name || !name.trim()) {
        errorList.push(`Row ${rowNum}: missing required field "name".`);
        continue;
      }
      if (!type || !type.trim()) {
        errorList.push(`Row ${rowNum}: missing required field "type".`);
        continue;
      }
      if (!dueDate || !dueDate.trim()) {
        errorList.push(`Row ${rowNum}: missing required field "dueDate".`);
        continue;
      }
      if (!quantityRaw || !quantityRaw.trim()) {
        errorList.push(`Row ${rowNum}: missing required field "quantity".`);
        continue;
      }

      // Validate quantity is a positive integer
      const quantity = Number(quantityRaw);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        errorList.push(
          `Row ${rowNum}: "quantity" must be a positive integer (got "${quantityRaw}").`,
        );
        continue;
      }

      // Validate dueDate parses to a valid date
      const parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        errorList.push(
          `Row ${rowNum}: "dueDate" is not a valid date string (got "${dueDate}").`,
        );
        continue;
      }

      try {
        const order = await createOrder(prisma, {
          name: name.trim(),
          type: type.trim(),
          dueDate: parsedDueDate,
          quantity,
          applicantId: ctx.user.id,
        });
        successes.push(order);
      } catch (rowErr) {
        const e = rowErr as { message?: string };
        errorList.push(
          `Row ${rowNum}: failed to create order — ${e.message ?? "unknown error"}.`,
        );
      }
    }

    return NextResponse.json({ successCount: successes.length, errorList });
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
