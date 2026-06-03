import { z } from "zod";
import { NextResponse } from "next/server";
import { CsrfError, UnauthorizedError } from "@/modules/auth/require-auth";
import { ForbiddenError } from "@/modules/auth/rbac";
import { OrderTypeSchema } from "@/modules/order/order-validation";

export const SchedulingConfigSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    frozenDays: z.number().int().min(0).default(0),
    productionDays: z.number().int().min(1).default(1),
    bufferDays: z.number().int().min(0).default(0),
    reschedulePolicy: z
      .enum(["GLOBAL_OPTIMIZE", "PRIORITY_RETAIN", "GAP_FILLING"])
      .default("GAP_FILLING"),
    algorithm: z.enum(["GREEDY_BEST_FIT"]).default("GREEDY_BEST_FIT"),
    splittable: z.boolean().default(true),
    targetOrderIds: z.array(z.string()).optional(),
  })
  .default({
    frozenDays: 0,
    productionDays: 1,
    bufferDays: 0,
    reschedulePolicy: "GAP_FILLING",
    algorithm: "GREEDY_BEST_FIT",
    splittable: true,
  });

export const ScheduleTypeSchema = z.object({ type: OrderTypeSchema });

/** Shared error handler for schedule API routes (run / preview / apply). */
export function handleScheduleError(
  error: unknown,
  context: string,
): NextResponse {
  if (
    error instanceof Error &&
    (error.message?.includes("already running") ||
      error.message?.includes("environment has changed"))
  ) {
    return NextResponse.json(
      { code: "CONFLICT", message: error.message },
      { status: 409 },
    );
  }
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
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { code: error.code, message: error.message },
      { status: error.status },
    );
  }
  console.error(`Error in ${context}:`, error);
  return NextResponse.json(
    { code: "INTERNAL_SERVER_ERROR", message: `Failed to ${context}` },
    { status: 500 },
  );
}
