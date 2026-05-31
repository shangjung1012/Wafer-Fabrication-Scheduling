import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { ForbiddenError } from "@/modules/auth/rbac";
import { getScopeGroup, resolveActorScope } from "@/modules/auth/scope";
import { validateOrderType } from "@/modules/order/order-validation";

export async function assertCanManageScheduleType(
  ctx: RequestContext,
  db: PrismaClient,
  type: string,
): Promise<void> {
  const productionType = validateOrderType(type);
  const scope = await resolveActorScope(ctx, db);

  if (scope.role === "ADMIN" && getScopeGroup(scope) !== productionType) {
    throw new ForbiddenError(
      "You can only manage schedules in your production group.",
    );
  }
}
