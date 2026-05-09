/**
 * prisma/seed.ts
 *
 * Run with: npx prisma db seed
 *
 * Seeds deterministic dev data:
 *   - 3 SUPERADMIN (one per production type: A, B, C)
 *   - 9 Factory    (3 per type)
 *   - 9 ADMIN      (one per factory)
 *   - 3 SALES      (one per type)
 *
 * All records use stable IDs so the seed is idempotent (safe to re-run).
 * The IDs are also the values you pass as <userId> in dev tokens:
 *   Authorization: Bearer dev:SUPERADMIN:sa-A
 *   Authorization: Bearer dev:ADMIN:admin-A1
 *   Authorization: Bearer dev:SALES:sales-A
 */

import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole, FactoryStatus } from "../lib/generated/prisma/client";

// Prisma 7 uses the "client" engine which requires a driver adapter.
// tsx runs this script directly and doesn't read prisma.config.ts,
// so we wire up the pg adapter manually here.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Data definitions
// ---------------------------------------------------------------------------

type SeedUser = {
  id: string;
  name: string;
  role: UserRole;
  group: string;
};

type SeedFactory = {
  id: string;
  productionType: string;
  adminId: string;
  status: FactoryStatus;
  maxCapacity: number;
};

const PRODUCTION_TYPES = ["A", "B", "C"] as const;

function buildUsers(): SeedUser[] {
  const users: SeedUser[] = [];

  for (const t of PRODUCTION_TYPES) {
    // SUPERADMIN per type
    users.push({
      id: `sa-${t}`,
      name: `SuperAdmin ${t}`,
      role: "SUPERADMIN",
      group: t,
    });

    // ADMIN per factory (3 factories per type)
    for (let i = 1; i <= 3; i++) {
      users.push({
        id: `admin-${t}${i}`,
        name: `Admin ${t}${i}`,
        role: "ADMIN",
        group: t,
      });
    }

    // SALES per type
    users.push({
      id: `sales-${t}`,
      name: `Sales ${t}`,
      role: "SALES",
      group: t,
    });
  }

  return users;
}

function buildFactories(): SeedFactory[] {
  const factories: SeedFactory[] = [];

  for (const t of PRODUCTION_TYPES) {
    for (let i = 1; i <= 3; i++) {
      factories.push({
        id: `factory-${t}${i}`,
        productionType: t,
        adminId: `admin-${t}${i}`,
        status: "ACTIVE",
        maxCapacity: 100,
      });
    }
  }

  return factories;
}

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------

async function seedUsers(users: SeedUser[]) {
  console.log(`  Upserting ${users.length} users…`);
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        name: u.name,
        role: u.role,
        group: u.group,
      },
      update: {
        name: u.name,
        role: u.role,
        group: u.group,
      },
    });
  }
}

async function seedFactories(factories: SeedFactory[]) {
  console.log(`  Upserting ${factories.length} factories…`);
  for (const f of factories) {
    await prisma.factory.upsert({
      where: { id: f.id },
      create: {
        id: f.id,
        productionType: f.productionType,
        admin: { connect: { id: f.adminId } },
        status: f.status,
        maxCapacity: f.maxCapacity,
      },
      update: {
        productionType: f.productionType,
        admin: { connect: { id: f.adminId } },
        status: f.status,
        maxCapacity: f.maxCapacity,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🌱 Starting seed…");

  const users = buildUsers();
  const factories = buildFactories();

  // Users must be seeded before factories (factories reference adminId → user.id)
  await seedUsers(users);
  await seedFactories(factories);

  console.log("✅ Seed complete.");
  console.log("");
  console.log("Dev token examples (paste as Authorization: Bearer <token>):");
  console.log("  SUPERADMIN type A : dev:SUPERADMIN:sa-A");
  console.log("  SUPERADMIN type B : dev:SUPERADMIN:sa-B");
  console.log("  ADMIN factory A1  : dev:ADMIN:admin-A1");
  console.log("  ADMIN factory B2  : dev:ADMIN:admin-B2");
  console.log("  SALES type A      : dev:SALES:sales-A");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
