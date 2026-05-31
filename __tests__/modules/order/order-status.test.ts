import { describe, expect, it } from "vitest";
import { OrderStatus } from "@/lib/generated/prisma";
import { assertOrderStatusTransition } from "@/modules/order/order-status";

describe("order status transitions", () => {
  it("allows valid lifecycle transitions", () => {
    expect(() =>
      assertOrderStatusTransition(OrderStatus.PENDING, OrderStatus.SCHEDULED),
    ).not.toThrow();
    expect(() =>
      assertOrderStatusTransition(
        OrderStatus.SCHEDULED,
        OrderStatus.IN_PRODUCTION,
      ),
    ).not.toThrow();
  });

  it("rejects transitions from terminal states", () => {
    expect(() =>
      assertOrderStatusTransition(OrderStatus.CANCELLED, OrderStatus.SCHEDULED),
    ).toThrow("Invalid order status transition");
    expect(() =>
      assertOrderStatusTransition(OrderStatus.COMPLETED, OrderStatus.CANCELLED),
    ).toThrow("Invalid order status transition");
  });
});
