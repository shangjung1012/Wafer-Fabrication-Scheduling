import type { PrismaClient } from "@/lib/generated/prisma";
import { FactoryStatus } from "@/lib/generated/prisma";

export async function findFactoriesWithCapacities(
  db: PrismaClient,
  type: string,
  currentDate: Date,
) {
  const todayMidnight = new Date(new Date(currentDate).setHours(0, 0, 0, 0));
  return db.factory.findMany({
    where: {
      productionType: type,
      status: FactoryStatus.ACTIVE,
    },
    include: {
      dailyCapacities: {
        where: {
          date: {
            gte: todayMidnight,
          },
        },
      },
    },
  });
}
