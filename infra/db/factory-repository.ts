import { PrismaClient, FactoryStatus } from "@/lib/generated/prisma/client";

export async function findFactoriesWithCapacities(
  db: PrismaClient | any,
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
