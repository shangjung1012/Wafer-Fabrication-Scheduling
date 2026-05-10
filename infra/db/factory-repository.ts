import type { PrismaClient } from "@/lib/generated/prisma";
import { FactoryStatus } from "@/lib/generated/prisma";

export async function findFactoriesWithCapacities(
  db: PrismaClient,
  type: string,
) {
  return db.factory.findMany({
    where: {
      productionType: type,
      status: FactoryStatus.ACTIVE,
    },
    include: {
      dailyCapacities: {
        where: {
          date: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      },
    },
  });
}
