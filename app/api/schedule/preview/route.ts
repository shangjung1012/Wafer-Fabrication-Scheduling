import { NextResponse } from "next/server";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import { z } from "zod";
import { previewSchedule } from "@/modules/schedule/preview";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { getScheduleVersion, setPreview } from "@/infra/redis/schedule-store";
import crypto from "crypto";
import { OrderStatus } from "@/lib/generated/prisma";

const SchedulingConfigSchema = z
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

const PreviewScheduleSchema = z.object({
  type: z.string().min(1, "Type is required"),
  config: SchedulingConfigSchema,
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);

    if (ctx.user.role !== "SUPERADMIN" && ctx.user.role !== "ADMIN") {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Insufficient permissions" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = PreviewScheduleSchema.safeParse(body);

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

    const { type, config } = parsed.data;

    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    if (!config.startDate) {
      const defaultStartDate = new Date(currentDate);
      defaultStartDate.setDate(defaultStartDate.getDate() + 1);
      config.startDate = defaultStartDate;
    }

    const strategyResult = await previewSchedule(
      type,
      config as SchedulingConfig,
      currentDate,
    );
    const version = await getScheduleVersion(type);
    const previewId = crypto.randomUUID();

    // Data Hydration for frontend
    const newSchedule = strategyResult.processedOrders.map((order) => {
      const newAssignmentsForOrder = strategyResult.newAssignments.filter(
        (a) => a.orderId === order.id,
      );
      return {
        ...order,
        assignments: [...(order.assignments || []), ...newAssignmentsForOrder],
      };
    });

    const affectedOrders = strategyResult.processedOrders.map((o) => o.id);

    // We determine failedOrderIds by checking if the order's final status is FAILED
    // (Orders that successfully scheduled will be SCHEDULED. Orders not processed aren't here).
    const failedOrderIds = newSchedule
      .filter((o) => o.status === OrderStatus.FAILED)
      .map((o) => o.id);

    // Basic conflict warnings
    const conflictWarnings: string[] = [];
    if (failedOrderIds.length > 0) {
      conflictWarnings.push(
        `There was not enough capacity to schedule ${failedOrderIds.length} orders.`,
      );
    }

    const payload = {
      type,
      config,
      version,
      result: strategyResult,
    };

    await setPreview(previewId, payload, 1800);

    return NextResponse.json({
      previewId,
      data: {
        newSchedule,
        affectedOrders,
        failedOrderIds,
        conflictWarnings,
      },
    });
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
    console.error("Error generating preview:", error);
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to generate preview" },
      { status: 500 },
    );
  }
}
