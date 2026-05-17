import type { PrismaClient } from "@/lib/generated/prisma";

const SINGLETON_ID = "global";

export async function getSystemState(db: PrismaClient) {
  return (
    (await db.systemState.findUnique({ where: { id: SINGLETON_ID } })) ?? {
      id: SINGLETON_ID,
      isSimulationMode: false,
      simulationDate: null,
    }
  );
}

export async function upsertSystemState(
  db: PrismaClient,
  patch: { isSimulationMode?: boolean; simulationDate?: Date | null },
) {
  return db.systemState.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...patch },
    update: patch,
  });
}
