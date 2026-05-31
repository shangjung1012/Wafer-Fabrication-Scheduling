import { z } from "zod";
import {
  STANDARD_PRODUCTION_TYPES,
  type StandardProductionType,
} from "@/modules/schedule/constants";

export const ORDER_MIN_QUANTITY = 25;
export const ORDER_MAX_QUANTITY = 2500;

export const OrderQuantitySchema = z
  .number()
  .int()
  .min(ORDER_MIN_QUANTITY, `quantity must be at least ${ORDER_MIN_QUANTITY}`)
  .max(ORDER_MAX_QUANTITY, `quantity must be at most ${ORDER_MAX_QUANTITY}`);

export const OrderTypeSchema = z
  .string()
  .refine(
    (type): type is StandardProductionType =>
      STANDARD_PRODUCTION_TYPES.includes(type as StandardProductionType),
    `type must be one of ${STANDARD_PRODUCTION_TYPES.join(", ")}`,
  );

export function validateOrderQuantity(quantity: number): number {
  return OrderQuantitySchema.parse(quantity);
}

export function validateOrderType(type: string): StandardProductionType {
  return OrderTypeSchema.parse(type);
}
