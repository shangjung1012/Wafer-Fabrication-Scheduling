import { z } from "zod";

export const ORDER_MIN_QUANTITY = 25;
export const ORDER_MAX_QUANTITY = 2500;

export const OrderQuantitySchema = z
  .number()
  .int()
  .min(ORDER_MIN_QUANTITY, `quantity must be at least ${ORDER_MIN_QUANTITY}`)
  .max(ORDER_MAX_QUANTITY, `quantity must be at most ${ORDER_MAX_QUANTITY}`);

export function validateOrderQuantity(quantity: number): number {
  return OrderQuantitySchema.parse(quantity);
}
