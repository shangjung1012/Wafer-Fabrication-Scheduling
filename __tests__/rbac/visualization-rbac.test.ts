/**
 * __tests__/rbac/visualization-rbac.test.ts
 *
 * Integration tests for Visualization RBAC.
 * Runs against the real dev DB — make sure `pnpm db:seed` has been run first.
 *
 * Run: pnpm test
 */

import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { getTimeline } from "@/modules/visualization/service";
import { ForbiddenError } from "@/modules/auth/rbac";

afterAll(async () => {
  await prisma.$disconnect();
});

const ctx = (id: string, role: RequestContext["user"]["role"]): RequestContext => ({
  user: { id, role },
  requestId: "test",
});

const salesA      = ctx("sales-A",   "SALES");
const adminA1     = ctx("admin-A1",  "ADMIN");
const adminB1     = ctx("admin-B1",  "ADMIN");
const superAdminA = ctx("sa-A",      "SUPERADMIN");
const superAdminB = ctx("sa-B",      "SUPERADMIN");

const FILTERS = { startDate: "2026-05-10", endDate: "2026-05-23" };

describe("Visualization RBAC", () => {
  it("SALES → ForbiddenError", async () => {
    await expect(
      getTimeline(salesA, prisma, FILTERS)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ADMIN admin-A1 → 看到整個 Type A（factory-A1/A2/A3）", async () => {
    const data = await getTimeline(adminA1, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["factory-A1", "factory-A2", "factory-A3"]));
    expect(ids.every((id) => id.startsWith("factory-A"))).toBe(true);
  });

  it("ADMIN admin-B1 → 看到整個 Type B（factory-B1/B2/B3）", async () => {
    const data = await getTimeline(adminB1, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["factory-B1", "factory-B2", "factory-B3"]));
    expect(ids.every((id) => id.startsWith("factory-B"))).toBe(true);
  });

  it("ADMIN admin-A1 的 timeline 不含 Type B/C 的資料", async () => {
    const data = await getTimeline(adminA1, prisma, FILTERS);
    const factoryIds = new Set(data.factories.map((f) => f.id));
    expect(
      data.timeline.every((t) => factoryIds.has(t.factoryId))
    ).toBe(true);
  });

  it("SUPERADMIN sa-A → 只看到 Type A 工廠，不含 B/C", async () => {
    const data = await getTimeline(superAdminA, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["factory-A1", "factory-A2", "factory-A3"]));
    expect(ids.every((id) => id.startsWith("factory-A"))).toBe(true);
  });

  it("SUPERADMIN sa-B → 只看到 Type B 工廠，不含 A/C", async () => {
    const data = await getTimeline(superAdminB, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["factory-B1", "factory-B2", "factory-B3"]));
    expect(ids.every((id) => id.startsWith("factory-B"))).toBe(true);
  });

  it("SUPERADMIN sa-A 的 timeline 不含 Type B/C 的訂單", async () => {
    const data = await getTimeline(superAdminA, prisma, FILTERS);
    const factoryIds = new Set(data.factories.map((f) => f.id));
    expect(
      data.timeline.every((t) => factoryIds.has(t.factoryId))
    ).toBe(true);
  });
});
