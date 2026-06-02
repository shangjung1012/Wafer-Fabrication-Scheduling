import { Prisma } from "@/lib/generated/prisma";
import type { PrismaClient } from "@/lib/generated/prisma";

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
  const exists = await db.dailyCapacity.findUnique({ where: { id } });
  if (!exists) return;

  await db.dailyCapacity.update({
    where: { id },
    data: { curCapacity },
  });
}

export async function bulkUpdateDailyCapacities(
  db: PrismaClient,
  updates: { id: string; curCapacity: number }[],
): Promise<Set<string>> {
  if (updates.length === 0) return new Set();

  const caps = await db.dailyCapacity.findMany({
    where: { id: { in: updates.map((u) => u.id) } },
    select: {
      id: true,
      curCapacity: true,
      factory: { select: { productionType: true } },
    },
  });

  const productionTypes = new Set(caps.map((c) => c.factory.productionType));
  const capMap = new Map(caps.map((c) => [c.id, c.curCapacity]));

  const changed = updates.filter(
    ({ id, curCapacity }) => capMap.has(id) && capMap.get(id) !== curCapacity,
  );

  if (changed.length === 0) return productionTypes;

  const values = changed.map(({ id, curCapacity }) =>
    Prisma.sql`(${id}::text, ${curCapacity}::int)`,
  );

  await db.$executeRaw`
    UPDATE daily_capacity
    SET "curCapacity" = v.cur_capacity
    FROM (VALUES ${Prisma.join(values)}) AS v(id, cur_capacity)
    WHERE daily_capacity.id = v.id
  `;

  return productionTypes;
}

export async function findDailyCapacity(
  db: PrismaClient,
  factoryId: string,
  date: Date,
) {
  return db.dailyCapacity.findFirst({
    where: { factoryId, date },
  });
}

export async function upsertDailyCapacityDelta(
  db: PrismaClient,
  factoryId: string,
  date: Date,
  delta: number,
  factoryMaxCapacity: number,
): Promise<void> {
  const existing = await db.dailyCapacity.findFirst({
    where: { factoryId, date },
  });
  if (existing) {
    await db.dailyCapacity.update({
      where: { id: existing.id },
      data: { curCapacity: existing.curCapacity + delta },
    });
    return;
  }
  await db.dailyCapacity.create({
    data: {
      factoryId,
      date,
      maxCapacity: factoryMaxCapacity,
      curCapacity: factoryMaxCapacity + delta,
    },
  });
}

export async function findDailyCapacitiesByDateRange(
  db: PrismaClient,
  factoryIds: string[],
  startDate: Date,
  endDate: Date,
) {
  if (factoryIds.length === 0) return [];
  return db.dailyCapacity.findMany({
    where: {
      factoryId: { in: factoryIds },
      date: { gte: startDate, lte: endDate },
    },
    select: {
      factoryId: true,
      date: true,
      curCapacity: true,
      maxCapacity: true,
    },
  });
}
