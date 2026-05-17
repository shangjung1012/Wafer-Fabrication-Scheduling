import type { PrismaClient, Factory } from "@/lib/generated/prisma";
import { FactoryStatus } from "@/lib/generated/prisma";
import { incrementScheduleVersion } from "@/infra/redis/schedule-store";

// For safty. If the factory is updated, the schedule version will be incremented, version will be checked before write back to DB.
export async function updateFactory(
  db: PrismaClient,
  id: string,
  input: {
    status?: FactoryStatus;
    maxCapacity?: number;
  },
): Promise<Factory | null> {
  const exists = await db.factory.findUnique({
    where: { id },
    select: { productionType: true },
  });

  if (!exists) return null;

  const result = await db.factory.update({
    where: { id },
    data: input,
  });

  if (input.status !== undefined || input.maxCapacity !== undefined) {
    await incrementScheduleVersion(exists.productionType);
  }

  return result;
}

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
