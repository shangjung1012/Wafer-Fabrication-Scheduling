import { OrderStatus } from "@/lib/generated/prisma";

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.SCHEDULED,
    OrderStatus.CANCELLED,
    OrderStatus.FAILED,
  ],
  [OrderStatus.SCHEDULED]: [
    OrderStatus.IN_PRODUCTION,
    OrderStatus.CANCELLED,
    OrderStatus.FAILED,
  ],
  [OrderStatus.IN_PRODUCTION]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.FAILED]: [
    OrderStatus.PENDING,
    OrderStatus.SCHEDULED,
    OrderStatus.CANCELLED,
  ],
};

export function assertOrderStatusTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (from === to) return;
  if (!allowedTransitions[from]?.includes(to)) {
    throw Object.assign(
      new Error(`Invalid order status transition: ${from} -> ${to}`),
      { status: 400, code: "INVALID_STATUS_TRANSITION" },
    );
  }
}
