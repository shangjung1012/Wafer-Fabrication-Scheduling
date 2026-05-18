/**
 * prisma/seed.ts
 *
 * Run with: pnpm db:seed
 *
 * Seeds deterministic dev data:
 *   - 3 SUPERADMIN (one per production type: A, B, C)
 *   - 9 Factory    (3 per type, maxCapacity: 1000)
 *   - 9 ADMIN      (one per factory)
 *   - 3 SALES      (one per type)
 *   - 13 Order     (spread across types, various statuses)
 *   - 25 OrderAssignment
 *   - 21 DailyCapacity   (computed from assignments)
 *
 * Type A is pre-configured for conflict_testcase.md Case 4:
 *   - factory-A1 2026-05-17: 900 IN_PRODUCTION → only 100 free
 *   - factory-A2 2026-05-17: 1000 IN_PRODUCTION → 0 free
 *   - factory-A3 2026-05-17: 1000 IN_PRODUCTION → 0 free
 *   - ord-seed-013 (Wafer-CF4-Base): APPROVED, qty=80, dueDate=May 17
 *     → on schedule run, takes the 100 free slots on A1, leaves 20
 *   - ord-seed-016 (Wafer-CF4-New):  PENDING,  qty=30, dueDate=May 17
 *     → admin approves it, then a single schedule run produces the conflict
 *       (20 remaining < 30 required → CONFLICT)
 *
 * All records use stable IDs so the seed is idempotent (safe to re-run).
 */

import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  UserRole,
  FactoryStatus,
  OrderStatus,
  AssignmentStatus,
} from "../lib/generated/prisma/client";
import { hashPassword } from "../modules/auth/password-service";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function d(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

type SeedUser = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  group: string;
};

type SeedFactory = {
  id: string;
  productionType: string;
  adminIds: string[];
  status: FactoryStatus;
  maxCapacity: number;
};

type SeedOrder = {
  id: string;
  name: string;
  type: string;
  quantity: number;
  dueDate: Date;
  applicantId: string;
  status: OrderStatus;
};

type SeedAssignment = {
  id: string;
  orderId: string;
  factoryId: string;
  productionDate: Date;
  assignedQuantity: number;
  status: AssignmentStatus;
};

type SeedDailyCapacity = {
  factoryId: string;
  date: Date;
  maxCapacity: number;
  curCapacity: number;
};

// ---------------------------------------------------------------------------
// Data builders
// ---------------------------------------------------------------------------

const PRODUCTION_TYPES = ["A", "B", "C"] as const;

function buildUsers(): SeedUser[] {
  const users: SeedUser[] = [];
  for (const t of PRODUCTION_TYPES) {
    users.push({
      id: `sa-${t}`,
      username: `sa-${t}`,
      email: `sa-${t.toLowerCase()}@mail.com`,
      role: "SUPERADMIN",
      group: t,
    });

    // ADMIN per factory (3 factories per type)
    for (let i = 1; i <= 3; i++) {
      users.push({
        id: `admin-${t}${i}`,
        username: `admin-${t}${i}`,
        email: `admin-${t.toLowerCase()}${i}@mail.com`,
        role: "ADMIN",
        group: t,
      });
    }

    users.push({
      id: `sales-${t}`,
      username: `sales-${t}`,
      email: `sales-${t.toLowerCase()}@mail.com`,
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
        adminIds: [`admin-${t}${i}`],
        status: "ACTIVE",
        maxCapacity: 1000,
      });
    }
  }
  return factories;
}

function buildOrders(): SeedOrder[] {
  return [
    // --- Type A ---
    // ord-seed-001: fully completed
    {
      id: "ord-seed-001",
      name: "Wafer-Alpha",
      type: "A",
      quantity: 300,
      dueDate: d("2026-05-14"),
      applicantId: "sales-A",
      status: "COMPLETED",
    },
    // ord-seed-002: split across A1 + A2, scheduled for June
    {
      id: "ord-seed-002",
      name: "Wafer-Beta",
      type: "A",
      quantity: 800,
      dueDate: d("2026-06-15"),
      applicantId: "sales-A",
      status: "SCHEDULED",
    },
    // ord-seed-003: in production on A1 + A2
    {
      id: "ord-seed-003",
      name: "Wafer-Gamma",
      type: "A",
      quantity: 650,
      dueDate: d("2026-05-16"),
      applicantId: "sales-A",
      status: "IN_PRODUCTION",
    },
    // ord-seed-004: scheduled for June (moved from past conflict scenario)
    {
      id: "ord-seed-004",
      name: "Wafer-Delta",
      type: "A",
      quantity: 350,
      dueDate: d("2026-06-20"),
      applicantId: "sales-A",
      status: "SCHEDULED",
    },
    // ord-seed-005: scheduled for late June
    {
      id: "ord-seed-005",
      name: "Wafer-Eta",
      type: "A",
      quantity: 800,
      dueDate: d("2026-06-25"),
      applicantId: "sales-A",
      status: "SCHEDULED",
    },
    // ord-seed-cf4: locks factory-A1(900) + A2(1000) + A3(1000) on May 17
    // IN_PRODUCTION so its assignments are never freed by the scheduler
    {
      id: "ord-seed-cf4",
      name: "Wafer-CF4-Lock",
      type: "A",
      quantity: 2900,
      dueDate: d("2026-05-25"),
      applicantId: "sales-A",
      status: "IN_PRODUCTION",
    },

    // --- Type B ---
    // ord-seed-006: split across B1 + B2
    {
      id: "ord-seed-006",
      name: "B-Lot-01",
      type: "B",
      quantity: 500,
      dueDate: d("2026-05-17"),
      applicantId: "sales-B",
      status: "SCHEDULED",
    },
    // ord-seed-007: dueDate conflict — production on 5/15 but dueDate 5/14
    {
      id: "ord-seed-007",
      name: "B-Lot-02",
      type: "B",
      quantity: 400,
      dueDate: d("2026-05-14"),
      applicantId: "sales-B",
      status: "SCHEDULED",
    },
    // ord-seed-008: split across B1 + B3
    {
      id: "ord-seed-008",
      name: "B-Lot-03",
      type: "B",
      quantity: 450,
      dueDate: d("2026-05-22"),
      applicantId: "sales-B",
      status: "SCHEDULED",
    },
    // ord-seed-009: normal, on B2
    {
      id: "ord-seed-009",
      name: "B-Lot-04",
      type: "B",
      quantity: 300,
      dueDate: d("2026-05-19"),
      applicantId: "sales-B",
      status: "SCHEDULED",
    },

    // --- Type C ---
    // ord-seed-010: completed
    {
      id: "ord-seed-010",
      name: "C-Wafer-01",
      type: "C",
      quantity: 800,
      dueDate: d("2026-05-13"),
      applicantId: "sales-C",
      status: "COMPLETED",
    },
    // ord-seed-011: split across C1 + C2
    {
      id: "ord-seed-011",
      name: "C-Wafer-02",
      type: "C",
      quantity: 600,
      dueDate: d("2026-05-18"),
      applicantId: "sales-C",
      status: "SCHEDULED",
    },
    // ord-seed-012: split across C1 + C3
    {
      id: "ord-seed-012",
      name: "C-Wafer-03",
      type: "C",
      quantity: 900,
      dueDate: d("2026-05-23"),
      applicantId: "sales-C",
      status: "SCHEDULED",
    },

    // --- PENDING (no assignments — ready for schedule engine or approval) ---
    // Case 4 base order: on schedule run, takes the 100 free slots on
    // factory-A1 May 17 (80 used, 20 remaining).
    {
      id: "ord-seed-013",
      name: "Wafer-CF4-Base",
      type: "A",
      quantity: 80,
      dueDate: d("2026-05-17"),
      applicantId: "sales-A",
      status: "PENDING",
    },
    {
      id: "ord-seed-014",
      name: "B-Pending-01",
      type: "B",
      quantity: 400,
      dueDate: d("2026-06-08"),
      applicantId: "sales-B",
      status: "PENDING",
    },
    {
      id: "ord-seed-015",
      name: "C-Pending-01",
      type: "C",
      quantity: 700,
      dueDate: d("2026-06-12"),
      applicantId: "sales-C",
      status: "PENDING",
    },

    // --- PENDING (awaiting admin approval) ---
    // Case 4 trigger order: same dueDate as ord-seed-013 but lower quantity,
    // so it gets lower priority. After ord-seed-013 takes 80 of the 100 free
    // slots on factory-A1 May 17, only 20 remain — this 30-qty order cannot
    // fit, triggering a true conflict (window total 20 < required 30).
    {
      id: "ord-seed-016",
      name: "Wafer-CF4-New",
      type: "A",
      quantity: 30,
      dueDate: d("2026-05-17"),
      applicantId: "sales-A",
      status: "PENDING",
    },
  ];
}

function buildAssignments(): SeedAssignment[] {
  return [
    // -----------------------------------------------------------------------
    // factory-A1  (maxCapacity: 1000)
    // 2026-05-10: 300 (ok)
    // 2026-05-13: 400+350+350 = 1100 → CAPACITY CONFLICT, ord-seed-004 due 5/12 → DUE DATE CONFLICT
    // 2026-05-15: 400 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-001",
      orderId: "ord-seed-001",
      factoryId: "factory-A1",
      productionDate: d("2026-05-10"),
      assignedQuantity: 300,
      status: "COMPLETED",
    },
    {
      id: "asgn-002",
      orderId: "ord-seed-002",
      factoryId: "factory-A1",
      productionDate: d("2026-05-13"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },
    {
      id: "asgn-003",
      orderId: "ord-seed-003",
      factoryId: "factory-A1",
      productionDate: d("2026-05-13"),
      assignedQuantity: 350,
      status: "IN_PRODUCTION",
    },
    {
      id: "asgn-004",
      orderId: "ord-seed-004",
      factoryId: "factory-A1",
      productionDate: d("2026-05-13"),
      assignedQuantity: 350,
      status: "SCHEDULED",
    },
    {
      id: "asgn-005",
      orderId: "ord-seed-005",
      factoryId: "factory-A1",
      productionDate: d("2026-05-15"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-A2  (maxCapacity: 1000)
    // 2026-05-12: 300 (ok)
    // 2026-05-14: 400 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-006",
      orderId: "ord-seed-003",
      factoryId: "factory-A2",
      productionDate: d("2026-05-12"),
      assignedQuantity: 300,
      status: "IN_PRODUCTION",
    },
    {
      id: "asgn-007",
      orderId: "ord-seed-002",
      factoryId: "factory-A2",
      productionDate: d("2026-05-14"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-A3  (maxCapacity: 1000)
    // 2026-05-19: 400 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-008",
      orderId: "ord-seed-005",
      factoryId: "factory-A3",
      productionDate: d("2026-05-19"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // Case 4 capacity locks — IN_PRODUCTION on 2026-05-17
    // factory-A1: 900/1000 locked → 100 free (ord-seed-013 will use 80)
    // factory-A2: 1000/1000 locked → 0 free
    // factory-A3: 1000/1000 locked → 0 free
    // -----------------------------------------------------------------------
    {
      id: "asgn-cf4-01",
      orderId: "ord-seed-cf4",
      factoryId: "factory-A1",
      productionDate: d("2026-05-17"),
      assignedQuantity: 900,
      status: "IN_PRODUCTION",
    },
    {
      id: "asgn-cf4-02",
      orderId: "ord-seed-cf4",
      factoryId: "factory-A2",
      productionDate: d("2026-05-17"),
      assignedQuantity: 1000,
      status: "IN_PRODUCTION",
    },
    {
      id: "asgn-cf4-03",
      orderId: "ord-seed-cf4",
      factoryId: "factory-A3",
      productionDate: d("2026-05-17"),
      assignedQuantity: 1000,
      status: "IN_PRODUCTION",
    },

    // -----------------------------------------------------------------------
    // factory-B1  (maxCapacity: 1000)
    // 2026-05-13: 300 (ok)
    // 2026-05-15: 400+350+300 = 1050 → CAPACITY CONFLICT, ord-seed-007 due 5/14 → DUE DATE CONFLICT
    // 2026-05-18: 100 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-009",
      orderId: "ord-seed-006",
      factoryId: "factory-B1",
      productionDate: d("2026-05-13"),
      assignedQuantity: 300,
      status: "SCHEDULED",
    },
    {
      id: "asgn-010",
      orderId: "ord-seed-007",
      factoryId: "factory-B1",
      productionDate: d("2026-05-15"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },
    {
      id: "asgn-011",
      orderId: "ord-seed-008",
      factoryId: "factory-B1",
      productionDate: d("2026-05-15"),
      assignedQuantity: 350,
      status: "SCHEDULED",
    },
    {
      id: "asgn-012",
      orderId: "ord-seed-009",
      factoryId: "factory-B1",
      productionDate: d("2026-05-15"),
      assignedQuantity: 300,
      status: "SCHEDULED",
    },
    {
      id: "asgn-013",
      orderId: "ord-seed-008",
      factoryId: "factory-B1",
      productionDate: d("2026-05-18"),
      assignedQuantity: 100,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-B2  (maxCapacity: 1000)
    // 2026-05-16: 200 (ok)
    // 2026-05-20: 300 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-014",
      orderId: "ord-seed-006",
      factoryId: "factory-B2",
      productionDate: d("2026-05-16"),
      assignedQuantity: 200,
      status: "SCHEDULED",
    },
    {
      id: "asgn-015",
      orderId: "ord-seed-009",
      factoryId: "factory-B2",
      productionDate: d("2026-05-20"),
      assignedQuantity: 300,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-B3  (maxCapacity: 1000)
    // 2026-05-22: 400 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-016",
      orderId: "ord-seed-008",
      factoryId: "factory-B3",
      productionDate: d("2026-05-22"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-C1  (maxCapacity: 1000)
    // 2026-05-10: 800 (ok)
    // 2026-05-13: 400 (ok)
    // 2026-05-17: 600 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-017",
      orderId: "ord-seed-010",
      factoryId: "factory-C1",
      productionDate: d("2026-05-10"),
      assignedQuantity: 800,
      status: "COMPLETED",
    },
    {
      id: "asgn-018",
      orderId: "ord-seed-011",
      factoryId: "factory-C1",
      productionDate: d("2026-05-13"),
      assignedQuantity: 400,
      status: "SCHEDULED",
    },
    {
      id: "asgn-019",
      orderId: "ord-seed-012",
      factoryId: "factory-C1",
      productionDate: d("2026-05-17"),
      assignedQuantity: 600,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-C2  (maxCapacity: 1000)
    // 2026-05-14: 200 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-020",
      orderId: "ord-seed-011",
      factoryId: "factory-C2",
      productionDate: d("2026-05-14"),
      assignedQuantity: 200,
      status: "SCHEDULED",
    },

    // -----------------------------------------------------------------------
    // factory-C3  (maxCapacity: 1000)
    // 2026-05-21: 300 (ok)
    // -----------------------------------------------------------------------
    {
      id: "asgn-021",
      orderId: "ord-seed-012",
      factoryId: "factory-C3",
      productionDate: d("2026-05-21"),
      assignedQuantity: 300,
      status: "SCHEDULED",
    },
  ];
}

function buildDailyCapacities(
  assignments: SeedAssignment[],
): SeedDailyCapacity[] {
  const MAX = 1000;

  // Aggregate used capacity per factory+date
  const usedMap = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.factoryId}__${a.productionDate.toISOString()}`;
    usedMap.set(key, (usedMap.get(key) ?? 0) + a.assignedQuantity);
  }

  const result: SeedDailyCapacity[] = [];
  for (const [key, used] of usedMap) {
    const [factoryId, dateIso] = key.split("__");
    result.push({
      factoryId,
      date: new Date(dateIso),
      maxCapacity: MAX,
      curCapacity: MAX - used, // negative = over capacity (conflict)
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function seedUsers(users: SeedUser[]) {
  console.log(`  Upserting ${users.length} users…`);
  const password = await hashPassword("Password123!");
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        username: u.username,
        email: u.email,
        password,
        role: u.role,
        group: u.group,
      },
      update: {
        username: u.username,
        email: u.email,
        password,
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
        admins: { connect: f.adminIds.map((id) => ({ id })) },
        status: f.status,
        maxCapacity: f.maxCapacity,
      },
      update: {
        productionType: f.productionType,
        admins: { set: f.adminIds.map((id) => ({ id })) },
        status: f.status,
        maxCapacity: f.maxCapacity,
      },
    });
  }
}

async function seedOrders(orders: SeedOrder[]) {
  console.log(`  Upserting ${orders.length} orders…`);
  for (const o of orders) {
    await prisma.order.upsert({
      where: { id: o.id },
      create: {
        id: o.id,
        name: o.name,
        type: o.type,
        quantity: o.quantity,
        dueDate: o.dueDate,
        applicant: { connect: { id: o.applicantId } },
        status: o.status,
      },
      update: {
        name: o.name,
        type: o.type,
        quantity: o.quantity,
        dueDate: o.dueDate,
        applicant: { connect: { id: o.applicantId } },
        status: o.status,
      },
    });
  }
}

async function seedAssignments(assignments: SeedAssignment[]) {
  console.log(`  Upserting ${assignments.length} assignments…`);
  for (const a of assignments) {
    await prisma.orderAssignment.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        order: { connect: { id: a.orderId } },
        factory: { connect: { id: a.factoryId } },
        productionDate: a.productionDate,
        assignedQuantity: a.assignedQuantity,
        status: a.status,
      },
      update: {
        order: { connect: { id: a.orderId } },
        factory: { connect: { id: a.factoryId } },
        productionDate: a.productionDate,
        assignedQuantity: a.assignedQuantity,
        status: a.status,
      },
    });
  }
}

async function seedDailyCapacities(capacities: SeedDailyCapacity[]) {
  console.log(`  Upserting ${capacities.length} daily capacity records…`);
  for (const c of capacities) {
    await prisma.dailyCapacity.upsert({
      where: { factoryId_date: { factoryId: c.factoryId, date: c.date } },
      create: {
        factory: { connect: { id: c.factoryId } },
        date: c.date,
        maxCapacity: c.maxCapacity,
        curCapacity: c.curCapacity,
      },
      update: {
        maxCapacity: c.maxCapacity,
        curCapacity: c.curCapacity,
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
  const orders = buildOrders();
  const assignments = buildAssignments();
  const capacities = buildDailyCapacities(assignments);

  await seedUsers(users);
  await seedFactories(factories);
  await seedOrders(orders);
  await seedAssignments(assignments);
  await seedDailyCapacities(capacities);

  console.log("");
  console.log("✅ Seed complete.");
  console.log("");
  console.log("Case 4 conflict demo (Type A):");
  console.log("  factory-A1 2026-05-17: 900 IN_PRODUCTION → 100 free");
  console.log("  factory-A2 2026-05-17: 1000 IN_PRODUCTION → 0 free");
  console.log("  factory-A3 2026-05-17: 1000 IN_PRODUCTION → 0 free");
  console.log(
    "  ord-seed-013 Wafer-CF4-Base  APPROVED  qty=80  due 2026-05-17",
  );
  console.log(
    "  ord-seed-016 Wafer-CF4-New   PENDING   qty=30  due 2026-05-17",
  );
  console.log("");
  console.log("PENDING orders (ready for schedule engine after approval):");
  console.log(
    "       - Wafer-CF4-Base (qty 80, higher priority) scheduled on A1 → 20 left",
  );
  console.log(
    "       - Wafer-CF4-New  (qty 30) cannot fit (window total 20 < 30) → CONFLICT",
  );
  console.log("");
  console.log("Login examples:");
  console.log("  username sa-A      password Password123!");
  console.log("  username admin-A1  password Password123!");
  console.log("  username sales-A   password Password123!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
