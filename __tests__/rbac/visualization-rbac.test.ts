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

afterAll(async () => {
  await prisma.$disconnect();
});

const ctx = (
  id: string,
  role: RequestContext["user"]["role"],
): RequestContext => ({
  user: { id, role },
  requestId: "test",
});

const sales1 = ctx("sales-1", "SALES");
const sales2 = ctx("sales-2", "SALES");
const sales3 = ctx("sales-3", "SALES");
const adminA1 = ctx("admin-A1", "ADMIN");
const adminB1 = ctx("admin-B1", "ADMIN");
const superAdminA = ctx("sa-A", "SUPERADMIN");
const superAdminB = ctx("sa-B", "SUPERADMIN");

const FILTERS = { startDate: "2026-05-10", endDate: "2026-05-23" };

describe("Visualization RBAC", () => {
  it("SALES sales-1 → 成功取得資料並附 salesContext", async () => {
    const data = await getTimeline(sales1, prisma, FILTERS);
    expect(data.salesContext).toBeDefined();
    expect(Array.isArray(data.salesContext!.myOrderIds)).toBe(true);
    expect(Array.isArray(data.salesContext!.pendingOrders)).toBe(true);
    expect(data.salesContext!.scheduleVersions).toBeDefined();
    expect(typeof data.salesContext!.scheduleVersions).toBe("object");
  });

  it("SALES sales-1 → 只看到有自己訂單排程的工廠", async () => {
    const data = await getTimeline(sales1, prisma, FILTERS);
    if (data.salesContext!.myOrderIds.length === 0) return; // no scheduled orders in seed range
    const myOrderIdSet = new Set(data.salesContext!.myOrderIds);
    // All factories in the view must contain at least one of sales-1's assignments
    const factoryIdsWithMyOrders = new Set(
      data.timeline
        .filter((t) => myOrderIdSet.has(t.orderId))
        .map((t) => t.factoryId),
    );
    for (const factory of data.factories) {
      expect(factoryIdsWithMyOrders.has(factory.id)).toBe(true);
    }
  });

  it("SALES sales-1 / sales-2 / sales-3 的 myOrderIds 兩兩不重疊", async () => {
    const [dataA, dataB, dataC] = await Promise.all([
      getTimeline(sales1, prisma, FILTERS),
      getTimeline(sales2, prisma, FILTERS),
      getTimeline(sales3, prisma, FILTERS),
    ]);
    const aIds = new Set(dataA.salesContext!.myOrderIds);
    const bIds = new Set(dataB.salesContext!.myOrderIds);
    const cIds = new Set(dataC.salesContext!.myOrderIds);
    expect([...aIds].filter((id) => bIds.has(id))).toHaveLength(0);
    expect([...aIds].filter((id) => cIds.has(id))).toHaveLength(0);
    expect([...bIds].filter((id) => cIds.has(id))).toHaveLength(0);
  });

  it("ADMIN admin-A1 → 看到整個 Type A（factory-A1/A2/A3）", async () => {
    const data = await getTimeline(adminA1, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["factory-A1", "factory-A2", "factory-A3"]),
    );
    expect(ids.every((id) => id.startsWith("factory-A"))).toBe(true);
  });

  it("ADMIN admin-B1 → 看到整個 Type B（factory-B1/B2/B3）", async () => {
    const data = await getTimeline(adminB1, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(["factory-B1", "factory-B2", "factory-B3"]),
    );
    expect(ids.every((id) => id.startsWith("factory-B"))).toBe(true);
  });

  it("ADMIN admin-A1 的 timeline 不含 Type B/C 的資料", async () => {
    const data = await getTimeline(adminA1, prisma, FILTERS);
    const factoryIds = new Set(data.factories.map((f) => f.id));
    expect(data.timeline.every((t) => factoryIds.has(t.factoryId))).toBe(true);
  });

  const SEED_FACTORY_IDS = [
    "factory-A1",
    "factory-A2",
    "factory-A3",
    "factory-B1",
    "factory-B2",
    "factory-B3",
    "factory-C1",
    "factory-C2",
    "factory-C3",
  ] as const;

  it("SUPERADMIN sa-A → 看到全部 Type A/B/C 種子工廠", async () => {
    const data = await getTimeline(superAdminA, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([...SEED_FACTORY_IDS]));
    expect(SEED_FACTORY_IDS.every((id) => ids.includes(id))).toBe(true);
    expect(
      ids.some(
        (id) => id.startsWith("factory-B") || id.startsWith("factory-C"),
      ),
    ).toBe(true);
  });

  it("SUPERADMIN sa-B → 同樣看到 A/B/C 種子工廠", async () => {
    const data = await getTimeline(superAdminB, prisma, FILTERS);
    const ids = data.factories.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining([...SEED_FACTORY_IDS]));
  });

  it("SUPERADMIN sa-A 的 adminContext.pendingOrders 含多個 type", async () => {
    const data = await getTimeline(superAdminA, prisma, FILTERS);
    const pending = data.adminContext?.pendingOrders ?? [];
    const types = new Set(pending.map((o) => o.type));
    if (pending.length >= 2) {
      expect(types.size).toBeGreaterThan(1);
    }
    for (const o of pending) {
      expect(o.type).toMatch(/^[ABC]$/);
    }
  });

  it("SUPERADMIN sa-A 的 timeline 僅含回傳工廠的 assignment", async () => {
    const data = await getTimeline(superAdminA, prisma, FILTERS);
    const factoryIds = new Set(data.factories.map((f) => f.id));
    expect(data.timeline.every((t) => factoryIds.has(t.factoryId))).toBe(true);
  });
});
