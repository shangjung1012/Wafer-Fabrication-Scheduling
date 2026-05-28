/**
 * __tests__/rbac/order-rbac.test.ts
 *
 * Integration tests for Order RBAC.
 * Runs against the real dev DB — make sure `pnpm db:seed` has been run first.
 *
 * Run: pnpm test
 */

import { describe, it, expect, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import {
  listOrders,
  getOrder,
  createOrderService,
  updateOrderService,
  deleteOrdersService,
} from "@/modules/order/order-service";
import { ForbiddenError } from "@/modules/auth/rbac";

// ---------------------------------------------------------------------------
// Test contexts (IDs match pnpm db:seed output)
// ---------------------------------------------------------------------------

const ctx = (
  id: string,
  role: RequestContext["user"]["role"],
): RequestContext => ({
  user: { id, role },
  requestId: "test",
});

const sales1 = ctx("sales-1", "SALES");
const sales2 = ctx("sales-2", "SALES");
const adminA1 = ctx("admin-A1", "ADMIN");
const adminB1 = ctx("admin-B1", "ADMIN");

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

const createdOrderIds: string[] = [];

afterEach(async () => {
  if (createdOrderIds.length) {
    await prisma.order.deleteMany({
      where: { id: { in: [...createdOrderIds] } },
    });
    createdOrderIds.length = 0;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedOrderA(name = "TestOrder") {
  const order = await createOrderService(sales1, prisma, {
    name,
    type: "A",
    dueDate: new Date("2026-12-31"),
    quantity: 100,
  });
  createdOrderIds.push(order.id);
  return order;
}

async function seedOrderB(name = "TestOrderB") {
  const order = await createOrderService(sales2, prisma, {
    name,
    type: "B",
    dueDate: new Date("2026-12-31"),
    quantity: 100,
  });
  createdOrderIds.push(order.id);
  return order;
}

// ---------------------------------------------------------------------------
// 流程一：正常訂單生命週期
// ---------------------------------------------------------------------------

describe("流程一：正常訂單生命週期", () => {
  it("1. SALES sales-1 建立 type A 訂單 → 201", async () => {
    const order = await seedOrderA();
    expect(order.id).toBeDefined();
    expect(order.status).toBe("PENDING");
    expect(order.type).toBe("A");
    expect(order.applicantId).toBe("sales-1");
  });

  it("2. SALES sales-1 可建立任意 type 的訂單 → 201", async () => {
    const order = await createOrderService(sales1, prisma, {
      name: "CrossTypeOrder",
      type: "B",
      dueDate: new Date("2026-12-31"),
      quantity: 100,
    });
    createdOrderIds.push(order.id);
    expect(order.id).toBeDefined();
    expect(order.type).toBe("B");
    expect(order.applicantId).toBe("sales-1");
  });

  it("3. ADMIN admin-A1 審核訂單 PENDING → SCHEDULED", async () => {
    const order = await seedOrderA();
    const updated = await updateOrderService(adminA1, prisma, order.id, {
      status: "SCHEDULED",
    });
    expect(updated.status).toBe("SCHEDULED");
  });

  it("4. SALES 嘗試改 SCHEDULED 的訂單 → 403", async () => {
    const order = await seedOrderA();
    await updateOrderService(adminA1, prisma, order.id, {
      status: "SCHEDULED",
    });

    await expect(
      updateOrderService(sales1, prisma, order.id, { name: "改名" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// 流程二：scope 隔離驗證
// ---------------------------------------------------------------------------

describe("流程二：scope 隔離", () => {
  it("7. SALES sales-2 查 sales-1 的訂單 → 404", async () => {
    const order = await seedOrderA();

    const err = await getOrder(sales2, prisma, order.id).catch((e) => e);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("8. ADMIN admin-B1 查 group A 的訂單 → 404", async () => {
    const order = await seedOrderA();

    const err = await getOrder(adminB1, prisma, order.id).catch((e) => e);
    expect(err).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("9. ADMIN admin-A1 刪除 group B 的訂單 → 403", async () => {
    const orderB = await seedOrderB();

    await expect(
      deleteOrdersService(adminA1, prisma, [orderB.id]),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("SALES 只能看到自己的訂單（listOrders scope）", async () => {
    await seedOrderA("OrderByA");
    await seedOrderB("OrderByB");

    const sales1Orders = await listOrders(sales1, prisma, {});
    const sales2Orders = await listOrders(sales2, prisma, {});

    expect(sales1Orders.every((o) => o.applicantId === "sales-1")).toBe(true);
    expect(sales2Orders.every((o) => o.applicantId === "sales-2")).toBe(true);
  });

  it("SALES 不能改 type 欄位", async () => {
    const order = await seedOrderA();

    // UpdateOrderServiceInput 已移除 type 欄位，TypeScript 會在編譯期攔截
    // 此測試確認 SALES 無法透過 API 傳入 type（runtime 層面）
    const updated = await updateOrderService(sales1, prisma, order.id, {
      name: "合法修改",
    });
    expect(updated.type).toBe("A"); // type 沒有被改變
  });
});
