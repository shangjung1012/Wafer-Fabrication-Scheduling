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
  currentDate: Date,
) {
  const todayMidnight = new Date(
    Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate(),
    ),
  );
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

/**
 * Load ACTIVE factories for `type`, including:
 *  - their admin users (id, email, username) for issue-created email recipients
 *  - daily capacities whose date falls within [windowStart, windowEnd]
 *
 * Used by the ConflictIssue auto-creation flow to build the contextSnapshot.
 */
export async function findFactoriesForIssueSnapshot(
  db: PrismaClient,
  type: string,
  windowStart: Date,
  windowEnd: Date,
) {
  return db.factory.findMany({
    where: {
      productionType: type,
      status: FactoryStatus.ACTIVE,
    },
    select: {
      id: true,
      productionType: true,
      maxCapacity: true,
      admins: {
        select: { id: true, email: true, username: true },
      },
      dailyCapacities: {
        where: {
          date: { gte: windowStart, lte: windowEnd },
        },
        select: {
          id: true,
          factoryId: true,
          date: true,
          maxCapacity: true,
          curCapacity: true,
        },
      },
    },
  });
}
