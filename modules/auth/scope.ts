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
};

export type AdminScope = {
  role: "ADMIN";
  userId: string;
  factoryIds: string[]; // N-to-N: admin can manage multiple factories
  productionType: string;
  group: string; // alias for productionType — use getScopeGroup() to avoid branching
};

export type SuperAdminScope = {
  role: "SUPERADMIN";
  userId: string;
  group: string;
};

export type ActorScope = SalesScope | AdminScope | SuperAdminScope;

/**
 * Extracts the production type (A | B | C) from any ActorScope.
 * Avoids role-branching in service code — use this instead of scope.group / scope.productionType.
 */
export function getScopeGroup(scope: ActorScope): string {
  if (scope.role === "SALES") {
    throw new ForbiddenError(
      "SALES users do not have a production type group.",
    );
  }
  return scope.group;
}

// ---------------------------------------------------------------------------
// resolveActorScope
// ---------------------------------------------------------------------------

/**
 * Resolves the caller's data-access scope by looking up their DB record.
 *
 * - SALES      → { userId }  (no group — order access is applicantId-based)
 * - ADMIN      → { userId, factoryIds, productionType }  (via _FactoryAdmins N-to-N)
 * - SUPERADMIN → { userId, group }
 *
 * Throws ForbiddenError if the account is missing required scope data
 * (e.g. SUPERADMIN with no group, ADMIN not assigned to any factory).
 */
export async function resolveActorScope(
  ctx: RequestContext,
  db: PrismaClient,
): Promise<ActorScope> {
  switch (ctx.user.role) {
    case "SALES": {
      return { role: "SALES", userId: ctx.user.id };
    }

    case "ADMIN": {
      const factories = await db.factory.findMany({
        where: { admins: { some: { id: ctx.user.id } } },
        select: { id: true, productionType: true },
      });
      if (factories.length === 0) {
        throw new ForbiddenError(
          "Your account is not assigned to any factory.",
        );
      }
      const productionType = factories[0].productionType;
      return {
        role: "ADMIN",
        userId: ctx.user.id,
        factoryIds: factories.map((f) => f.id),
        productionType,
        group: productionType,
      };
    }

    case "SUPERADMIN": {
      const user = await db.user.findUnique({
        where: { id: ctx.user.id },
        select: { group: true },
      });
      if (!user?.group) {
        throw new ForbiddenError(
          "Your account does not have a production type assigned.",
        );
      }
      return { role: "SUPERADMIN", userId: ctx.user.id, group: user.group };
    }
  }
}
