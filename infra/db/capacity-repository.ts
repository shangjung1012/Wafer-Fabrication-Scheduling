import type { PrismaClient } from "@/lib/generated/prisma";
import { incrementScheduleVersion } from "@/infra/redis/schedule-store";

export type CreateDailyCapacityInput = {
  factoryId: string;
  date: Date;
  maxCapacity: number;
  curCapacity: number;
};

export async function createDailyCapacities(
  db: PrismaClient,
  capacities: CreateDailyCapacityInput[],
): Promise<void> {
  if (capacities.length === 0) return;
  await db.dailyCapacity.createMany({ data: capacities, skipDuplicates: true });
}

export async function updateDailyCapacityById(
  db: PrismaClient,
  id: string,
  curCapacity: number,
): Promise<void> {
  const exists = await db.dailyCapacity.findUnique({
    where: { id },
    include: { factory: true },
  });

  if (!exists) return;

  await db.dailyCapacity.update({
    where: { id },
    data: { curCapacity },
  });

  await incrementScheduleVersion(exists.factory.productionType);
}
