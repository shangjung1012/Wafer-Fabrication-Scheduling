import { describe, expect, it } from "vitest";
import { getScopeGroup, resolveActorScope } from "@/modules/auth/scope";
import { ForbiddenError } from "@/modules/auth/rbac";
import type { RequestContext } from "@/modules/auth/request-context";
import type { PrismaClient } from "@/lib/generated/prisma/client";

function ctx(
  role: RequestContext["user"]["role"],
  id = "user-1",
): RequestContext {
  return { user: { id, role }, requestId: "req-1" };
}

// Minimal prisma stub typed to the parts we need
function makeDb(overrides: Partial<PrismaClient> = {}): PrismaClient {
  return overrides as unknown as PrismaClient;
}

describe("getScopeGroup", () => {
  it("returns group for ADMIN scope", () => {
    const scope = {
      role: "ADMIN" as const,
      userId: "u",
      factoryIds: ["f1"],
      productionType: "A",
      group: "A",
    };
    expect(getScopeGroup(scope)).toBe("A");
  });

  it("throws ForbiddenError for SALES scope", () => {
    const scope = { role: "SALES" as const, userId: "u" };
    expect(() => getScopeGroup(scope)).toThrow(ForbiddenError);
  });

  it("throws ForbiddenError for SUPERADMIN scope", () => {
    const scope = { role: "SUPERADMIN" as const, userId: "u", group: "A" };
    expect(() => getScopeGroup(scope)).toThrow(ForbiddenError);
  });
});

describe("resolveActorScope", () => {
  it("resolves SALES scope with just userId", async () => {
    const scope = await resolveActorScope(ctx("SALES"), makeDb());
    expect(scope.role).toBe("SALES");
    expect(scope.userId).toBe("user-1");
  });

  it("resolves ADMIN scope with factory assignments", async () => {
    const db = makeDb({
      factory: {
        findMany: async () => [
          { id: "factory-A1", productionType: "A" },
          { id: "factory-A2", productionType: "A" },
        ],
      } as unknown as PrismaClient["factory"],
    });

    const scope = await resolveActorScope(ctx("ADMIN"), db);
    expect(scope.role).toBe("ADMIN");
    if (scope.role === "ADMIN") {
      expect(scope.factoryIds).toEqual(["factory-A1", "factory-A2"]);
      expect(scope.productionType).toBe("A");
      expect(scope.group).toBe("A");
    }
  });

  it("throws ForbiddenError when ADMIN has no factory assignments", async () => {
    const db = makeDb({
      factory: {
        findMany: async () => [],
      } as unknown as PrismaClient["factory"],
    });

    await expect(resolveActorScope(ctx("ADMIN"), db)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("resolves SUPERADMIN scope with group from DB", async () => {
    const db = makeDb({
      user: {
        findUnique: async () => ({ group: "A" }),
      } as unknown as PrismaClient["user"],
    });

    const scope = await resolveActorScope(ctx("SUPERADMIN"), db);
    expect(scope.role).toBe("SUPERADMIN");
    if (scope.role === "SUPERADMIN") {
      expect(scope.group).toBe("A");
    }
  });

  it("resolves SUPERADMIN scope with null group when user not found", async () => {
    const db = makeDb({
      user: {
        findUnique: async () => null,
      } as unknown as PrismaClient["user"],
    });

    const scope = await resolveActorScope(ctx("SUPERADMIN"), db);
    expect(scope.role).toBe("SUPERADMIN");
    if (scope.role === "SUPERADMIN") {
      expect(scope.group).toBeNull();
    }
  });

  it("throws ForbiddenError for SYSTEM role", async () => {
    await expect(resolveActorScope(ctx("SYSTEM"), makeDb())).rejects.toThrow(
      ForbiddenError,
    );
  });
});
