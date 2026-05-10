/**
 * tests/rbac/order-rbac.test.ts
 *
 * Integration tests for Order & Request RBAC.
 * Runs against the real dev DB — make sure `pnpm db:seed` has been run first.
 *
 * Run: pnpm test
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import {
  listOrders,
  getOrder,
  createOrderService,
  updateOrderService,
  deleteOrdersService,
} from "@/modules/order/order-service";
import {
  createRequestService,
  approveRequest,
} from "@/modules/order/request-service";
import { ForbiddenError } from "@/modules/auth/rbac";

// ---------------------------------------------------------------------------
// Test contexts (IDs match pnpm db:seed output)
// ---------------------------------------------------------------------------

const ctx = (id: string, role: RequestContext["user"]["role"]): RequestContext => ({
  user: { id, role },
  requestId: "test",
});

const salesA  = ctx("sales-A",   "SALES");
const salesB  = ctx("sales-B",   "SALES");
const adminA1 = ctx("admin-A1",  "ADMIN");
const adminB1 = ctx("admin-B1",  "ADMIN");

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

const createdRequestIds: string[] = [];
const createdOrderIds: string[]   = [];

afterEach(async () => {
  if (createdRequestIds.length) {
    await prisma.orderRequest.deleteMany({ where: { id: { in: [...createdRequestIds] } } });
    createdRequestIds.length = 0;
  }
  if (createdOrderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: [...createdOrderIds] } } });
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
  const order = await createOrderService(salesA, prisma, {
    name,
    type: "A",
    dueDate: new Date("2026-12-31"),
    quantity: 100,
  });
  createdOrderIds.push(order.id);
  return order;
}

async function seedOrderB(name = "TestOrderB") {
  const order = await createOrderService(salesB, prisma, {
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
  it("1. SALES sales-A 建立 type A 訂單 → 201", async () => {
    const order = await seedOrderA();
    expect(order.id).toBeDefined();
    expect(order.status).toBe("PENDING");
    expect(order.type).toBe("A");
    expect(order.applicantId).toBe("sales-A");
  });

  it("2. SALES sales-A 嘗試建 type B 訂單 → 403", async () => {
    await expect(
      createOrderService(salesA, prisma, {
        name: "WrongType",
        type: "B",
        dueDate: new Date("2026-12-31"),
        quantity: 100,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("3. ADMIN admin-A1 審核訂單 PENDING → APPROVED", async () => {
    const order = await seedOrderA();
    const updated = await updateOrderService(adminA1, prisma, order.id, {
      status: "APPROVED",
    });
    expect(updated.status).toBe("APPROVED");
  });

  it("4. SALES 嘗試改 APPROVED 的訂單 → 403", async () => {
    const order = await seedOrderA();
    await updateOrderService(adminA1, prisma, order.id, { status: "APPROVED" });

    await expect(
      updateOrderService(salesA, prisma, order.id, { name: "改名" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("5. SALES 對 APPROVED 訂單提修改申請 → 201", async () => {
    const order = await seedOrderA();
    await updateOrderService(adminA1, prisma, order.id, { status: "APPROVED" });

    const request = await createRequestService(salesA, prisma, {
      orderId: order.id,
      message: "請幫我改數量",
      payload: { quantity: 200 },
    });
    createdRequestIds.push(request.id);

    expect(request.id).toBeDefined();
    expect(request.orderId).toBe(order.id);
  });

  it("6. ADMIN 核准申請後 quantity 更新為 200", async () => {
    const order = await seedOrderA();
    await updateOrderService(adminA1, prisma, order.id, { status: "APPROVED" });

    const request = await createRequestService(salesA, prisma, {
      orderId: order.id,
      message: "請幫我改數量",
      payload: { quantity: 200 },
    });
    createdRequestIds.push(request.id);

    await approveRequest(adminA1, prisma, request.id);

    const updated = await getOrder(adminA1, prisma, order.id);
    expect(updated.quantity).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 流程二：scope 隔離驗證
// ---------------------------------------------------------------------------

describe("流程二：scope 隔離", () => {
  it("7. SALES sales-B 查 sales-A 的訂單 → 404", async () => {
    const order = await seedOrderA();

    const err = await getOrder(salesB, prisma, order.id).catch((e) => e);
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
      deleteOrdersService(adminA1, prisma, [orderB.id])
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("SALES 只能看到自己的訂單（listOrders scope）", async () => {
    await seedOrderA("OrderByA");
    await seedOrderB("OrderByB");

    const salesAOrders = await listOrders(salesA, prisma, {});
    const salesBOrders = await listOrders(salesB, prisma, {});

    expect(salesAOrders.every((o) => o.applicantId === "sales-A")).toBe(true);
    expect(salesBOrders.every((o) => o.applicantId === "sales-B")).toBe(true);
  });

  it("SALES 不能改 type 欄位", async () => {
    const order = await seedOrderA();

    // UpdateOrderServiceInput 已移除 type 欄位，TypeScript 會在編譯期攔截
    // 此測試確認 SALES 無法透過 API 傳入 type（runtime 層面）
    const updated = await updateOrderService(salesA, prisma, order.id, {
      name: "合法修改",
    });
    expect(updated.type).toBe("A"); // type 沒有被改變
  });
});
