import { z } from "zod";
import { OrderTypeSchema } from "@/modules/order/order-validation";

export const SchedulingConfigSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    frozenDays: z.number().int().min(0).default(0),
    productionDays: z.number().int().min(1).default(1),
    bufferDays: z.number().int().min(0).default(0),
    reschedulePolicy: z
      .enum(["GLOBAL_OPTIMIZE", "PRIORITY_RETAIN", "GAP_FILLING"])
      .default("GAP_FILLING"),
    algorithm: z.enum(["GREEDY_BEST_FIT"]).default("GREEDY_BEST_FIT"),
    splittable: z.boolean().default(true),
    targetOrderIds: z.array(z.string()).optional(),
  })
  .default({
    frozenDays: 0,
    productionDays: 1,
    bufferDays: 0,
    reschedulePolicy: "GAP_FILLING",
    algorithm: "GREEDY_BEST_FIT",
    splittable: true,
  });

export const ScheduleTypeSchema = z.object({ type: OrderTypeSchema });
