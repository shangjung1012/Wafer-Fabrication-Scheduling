import { PrismaClient, OrderStatus } from "@/lib/generated/prisma/client";

export async function findOrdersForScheduling(
  db: PrismaClient | any,
  type: string,
) {
  return db.order.findMany({
    where: {
      type,
      status: {
        in: [
          OrderStatus.APPROVED,
          OrderStatus.SCHEDULED,
          OrderStatus.IN_PRODUCTION,
        ],
      },
    },
    include: {
      assignments: true,
    },
  });
}
