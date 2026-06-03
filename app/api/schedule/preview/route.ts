import { NextResponse } from "next/server";
import { requireAuth } from "@/modules/auth/require-auth";
import { z } from "zod";
import { previewSchedule } from "@/modules/schedule/preview";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import { getScheduleVersion, setPreview } from "@/infra/redis/schedule-store";
import crypto from "crypto";
import { OrderStatus } from "@/lib/generated/prisma";
import { getTime } from "@/lib/get-time";
import { prisma } from "@/lib/prisma";
import { assertCanManageScheduleType } from "@/modules/schedule/access-control";
import { OrderTypeSchema } from "@/modules/order/order-validation";
import {
  SchedulingConfigSchema,
  handleScheduleError,
} from "@/app/api/schedule/_shared";

const PreviewScheduleSchema = z.object({
  type: OrderTypeSchema,
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
    await assertCanManageScheduleType(ctx, prisma, type);

    const currentDate = await getTime();

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
      },
    });
  } catch (error) {
    return handleScheduleError(error, "generate preview");
  }
}
