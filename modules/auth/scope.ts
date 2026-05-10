/**
 * modules/auth/scope.ts
 *
 * Resolves the authenticated user's data-access scope from the DB.
 *
 * Usage in any service:
 *   const scope = await resolveActorScope(ctx, db)
 *   // then use scope to build WHERE filters or assert resource access
 */

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";
import { ForbiddenError } from "@/modules/auth/rbac";

// ---------------------------------------------------------------------------
// ActorScope — the resolved identity of the caller
// ---------------------------------------------------------------------------

export type SalesScope = {
  role: "SALES";
  userId: string;
  group: string;
};

export type AdminScope = {
  role: "ADMIN";
  userId: string;
  factoryId: string;
  productionType: string;
};

export type SuperAdminScope = {
  role: "SUPERADMIN";
  userId: string;
  group: string;
};

export type ActorScope = SalesScope | AdminScope | SuperAdminScope;

// ---------------------------------------------------------------------------
// resolveActorScope
// ---------------------------------------------------------------------------

/**
 * Resolves the caller's data-access scope by looking up their DB record.
 *
 * - SALES      → { userId, group }
 * - ADMIN      → { userId, factoryId, productionType }  (via Factory.adminId)
 * - SUPERADMIN → { userId, group }
 *
 * Throws ForbiddenError if the account is missing required scope data
 * (e.g. SUPERADMIN with no group, ADMIN not assigned to any factory).
 */
export async function resolveActorScope(
  ctx: RequestContext,
  db: PrismaClient
): Promise<ActorScope> {
  switch (ctx.user.role) {
    case "SALES": {
      const user = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { group: true },
      });
      if (!user?.group) {
        throw new ForbiddenError("Your account does not have a production type assigned.");
      }
      return { role: "SALES", userId: ctx.user.id, group: user.group };
    }

    case "ADMIN": {
      const factory = await db.factory.findFirst({
        where: { adminId: ctx.user.id },
        select: { id: true, productionType: true },
      });
      if (!factory) {
        throw new ForbiddenError("Your account is not assigned to any factory.");
      }
      return {
        role: "ADMIN",
        userId: ctx.user.id,
        factoryId: factory.id,
        productionType: factory.productionType,
      };
    }

    case "SUPERADMIN": {
      const user = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { group: true },
      });
      if (!user?.group) {
        throw new ForbiddenError("Your account does not have a production type assigned.");
      }
      return { role: "SUPERADMIN", userId: ctx.user.id, group: user.group };
    }
  }
}
