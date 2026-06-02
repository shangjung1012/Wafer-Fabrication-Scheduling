import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireAuth,
  UnauthorizedError,
  CsrfError,
} from "@/modules/auth/require-auth";
import {
  requireRole,
  ForbiddenError,
  unauthorizedResponse,
  csrfResponse,
  forbiddenResponse,
  badRequestResponse,
} from "@/modules/auth/rbac";
import {
  getAutoSchedulerConfigs,
  updateAutoSchedulerConfig,
} from "@/infra/db/auto-scheduler-config-repository";
import { assertCanManageScheduleType } from "@/modules/schedule/access-control";

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const configs = await getAutoSchedulerConfigs(prisma);
    return NextResponse.json(configs);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse(error.message);
    }
    if (error instanceof CsrfError) {
      return csrfResponse(error.message);
    }
    if (error instanceof ForbiddenError) {
      return forbiddenResponse(error);
    }
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch configs" },
      { status: 500 },
    );
  }
}

const PatchSchema = z.object({
  type: z.string().min(1),
  isOperating: z.boolean().optional(),
  frozenDays: z.number().int().min(0).optional(),
  productionDays: z.number().int().min(1).optional(),
  bufferDays: z.number().int().min(0).optional(),
  reschedulePolicy: z
    .enum(["GLOBAL_OPTIMIZE", "PRIORITY_RETAIN", "GAP_FILLING"])
    .optional(),
  algorithm: z.enum(["GREEDY_BEST_FIT"]).optional(),
  splittable: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request);
    requireRole(ctx, ["SUPERADMIN", "ADMIN"]);

    const body = await request.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return badRequestResponse("Invalid input");
    }

    const { type, ...patchData } = parsed.data;
    await assertCanManageScheduleType(ctx, prisma, type);
    const config = await updateAutoSchedulerConfig(prisma, type, patchData);
    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return unauthorizedResponse(error.message);
    }
    if (error instanceof CsrfError) {
      return csrfResponse(error.message);
    }
    if (error instanceof ForbiddenError) {
      return forbiddenResponse(error);
    }
    return NextResponse.json(
      { code: "INTERNAL_SERVER_ERROR", message: "Failed to update config" },
      { status: 500 },
    );
  }
}
