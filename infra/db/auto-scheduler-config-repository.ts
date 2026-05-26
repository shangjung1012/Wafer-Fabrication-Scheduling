import type { PrismaClient } from "@/lib/generated/prisma";

export async function getAutoSchedulerConfigs(db: PrismaClient) {
  return db.autoSchedulerConfig.findMany();
}

export async function getAutoSchedulerConfigByType(
  db: PrismaClient,
  type: string,
) {
  return db.autoSchedulerConfig.findUnique({ where: { type } });
}

export async function updateAutoSchedulerConfig(
  db: PrismaClient,
  type: string,
  patch: {
    isOperating?: boolean;
    frozenDays?: number;
    productionDays?: number;
    bufferDays?: number;
    reschedulePolicy?: string;
    algorithm?: string;
    splittable?: boolean;
  },
) {
  return db.autoSchedulerConfig.upsert({
    where: { type },
    create: { type, ...patch },
    update: patch,
  });
}

export async function getOperatingAutoSchedulerConfigs(db: PrismaClient) {
  return db.autoSchedulerConfig.findMany({ where: { isOperating: true } });
}
