import { describe, expect, it } from "vitest";
import {
  ORDER_MAX_QUANTITY,
  ORDER_MIN_QUANTITY,
  OrderQuantitySchema,
} from "@/modules/order/order-validation";

describe("order validation", () => {
  it("accepts the required wafer quantity boundaries", () => {
    expect(OrderQuantitySchema.parse(ORDER_MIN_QUANTITY)).toBe(25);
    expect(OrderQuantitySchema.parse(ORDER_MAX_QUANTITY)).toBe(2500);
  });

  it("rejects wafer quantities outside 25 to 2500", () => {
    expect(() => OrderQuantitySchema.parse(24)).toThrow();
    expect(() => OrderQuantitySchema.parse(2501)).toThrow();
  });
});
