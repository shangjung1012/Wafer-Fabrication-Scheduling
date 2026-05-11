/**
 * lib/prisma.ts
 *
 * Shared Prisma client singleton.
 *
 * Prisma 7 uses the "client" engine which requires a driver adapter.
 * We use @prisma/adapter-pg (already in dependencies) with a pg Pool.
 *
 * Re-uses a single instance in development to avoid exhausting DB connections
 * across Next.js hot reloads.
 */

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createPrisma(): PrismaClient {
  const pool =
    globalForPrisma.pgPool ??
    new Pool({
      connectionString: process.env.DATABASE_URL,
    });
  if (!globalForPrisma.pgPool) globalForPrisma.pgPool = pool;

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
