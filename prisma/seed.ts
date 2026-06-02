/**
 * prisma/seed.ts
 *
 * Run with: pnpm db:seed
 *
 * Seeds deterministic dev data for a specific scheduling algorithm demo.
 * Simulation Date: 2026-06-03
 * All factories forced to 10000 max capacity.
 */

process.env.TZ = "UTC";

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
  group: string | null;
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
  isFixed?: boolean;
  isPrioritized?: boolean;
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
  for (let i = 1; i <= 3; i++) {
    users.push({
      id: `sa-${i}`,
      username: `SA-${i}`,
      email: `sa-${i}@mail.com`,
      role: "SUPERADMIN",
      group: null,
    });
  }
  for (const t of PRODUCTION_TYPES) {

    for (let i = 1; i <= 3; i++) {
      users.push({
        id: `admin-${t}${i}`,
        username: `admin-${t}${i}`,
        email: `admin-${t.toLowerCase()}${i}@mail.com`,
        role: "ADMIN",
        group: t,
      });
    }
  }

  for (let i = 1; i <= 10; i++) {
    users.push({
      id: `sales-${i}`,
      username: `sales-${i}`,
      email: `sales-${i}@mail.com`,
      role: "SALES",
      group: null,
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
        maxCapacity: 10000,
      });
    }
  }
  return factories;
}

function generateOrdersAndAssignments() {
  let orderCounter = 1;
  let asgnCounter = 1;
  /** Every seeded order rotates applicant across sales-1 … sales-10 (even split; not tied to order type). */
  const SALES_APPLICANTS = Array.from(
    { length: 10 },
    (_, i) => `sales-${i + 1}`,
  );
  let salesRoundRobin = 0;
  const orders: SeedOrder[] = [];
  const assignments: SeedAssignment[] = [];

  function addOrder(
    type: "A" | "B" | "C",
    quantity: number,
    dueDate: Date,
    status: OrderStatus,
    factoryId?: string,
    productionDate?: Date,
    asgnStatus?: AssignmentStatus,
    isFixed?: boolean,
    isPrioritized?: boolean,
  ) {
    const oid = `ord-seed-${String(orderCounter++).padStart(3, "0")}`;
    orders.push({
      id: oid,
      name: `Wafer-${type}-demo-${orderCounter}`,
      type,
      quantity,
      dueDate,
      applicantId: SALES_APPLICANTS[salesRoundRobin++ % SALES_APPLICANTS.length],
      status,
      isFixed,
      isPrioritized,
    });

    if (factoryId && productionDate && asgnStatus) {
      assignments.push({
        id: `asgn-${String(asgnCounter++).padStart(3, "0")}`,
        orderId: oid,
        factoryId,
        productionDate,
        assignedQuantity: quantity,
        status: asgnStatus,
      });
    }
  }

  // Rule 3 (Current Date Load): Date 2026-06-03, 100% utilization (10000 total) -> 4 * 2500, IN_PRODUCTION
  const simDate = d("2026-06-03");
  const simDueDate = d("2026-06-05"); // Due date after production date
  for (const t of PRODUCTION_TYPES) {
    for (let i = 1; i <= 3; i++) {
      const fId = `factory-${t}${i}`;
      for (let k = 0; k < 4; k++) {
        addOrder(
          t,
          2500,
          simDueDate,
          "IN_PRODUCTION",
          fId,
          simDate,
          "IN_PRODUCTION",
        );
      }
    }
  }

  // Rule 4 (Scheduled Load): Dates 2026-06-04 to 2026-06-10
  // Consume 9000 capacity -> 3 * 2500 + 1 * 1500, SCHEDULED
  let fixedScheduledCreated = false;
  for (let day = 4; day <= 10; day++) {
    const prodDate = d(`2026-06-${String(day).padStart(2, "0")}`);
    const dueDate = d(`2026-06-${String(day + 2).padStart(2, "0")}`); // Due date 2 days after production
    for (const t of PRODUCTION_TYPES) {
      for (let i = 1; i <= 3; i++) {
        const fId = `factory-${t}${i}`;
        for (let k = 0; k < 3; k++) {
          addOrder(t, 2500, dueDate, "SCHEDULED", fId, prodDate, "SCHEDULED");
        }
        if (!fixedScheduledCreated && t === "A" && day === 4 && i === 1) {
          addOrder(
            t,
            2000,
            dueDate,
            "SCHEDULED",
            fId,
            prodDate,
            "SCHEDULED",
            true,
            false,
          );
          fixedScheduledCreated = true;
        } else {
          addOrder(t, 1500, dueDate, "SCHEDULED", fId, prodDate, "SCHEDULED");
        }
      }
    }
  }

  // Rule 5 & 6 (Pending Orders / Guaranteed Failure):
  // We want to force failures even under GLOBAL_OPTIMIZE.
  // GLOBAL_OPTIMIZE can push existing SCHEDULED orders up to their due dates (max 06-12).
  // Total capacity per type across 9 days (06-04 to 06-12) = 9 days * 3 factories * 10,000 = 270,000.
  // Existing SCHEDULED demand per type = 7 days * 27,000 = 189,000.
  // Remaining absolute capacity = 81,000 per type.
  // By adding 35 pending orders per type of quantity 2500 (87,500 demand per type) with dueDate 06-10,
  // the total demand (189,000 + 87,500 = 276,500) slightly exceeds the absolute 9-day capacity (270,000) by 6,500.
  // This mathematically guarantees 2 or 3 FAILED orders per type (6,500 / 2500).
  const pendingDueDate = d("2026-06-10"); // Tight deadline to force FAILED
  let prioritizedPendingCreated = false;
  for (const t of PRODUCTION_TYPES) {
    for (let i = 0; i < 35; i++) {
      if (!prioritizedPendingCreated && t === "A" && i === 0) {
        addOrder(
          t,
          1700,
          pendingDueDate,
          "PENDING",
          undefined,
          undefined,
          undefined,
          false,
          true,
        );
        prioritizedPendingCreated = true;
      } else {
        addOrder(t, 2500, pendingDueDate, "PENDING");
      }
    }
  }

  return { orders, assignments };
}

function buildDailyCapacities(
  factories: SeedFactory[],
  assignments: SeedAssignment[],
): SeedDailyCapacity[] {
  const MAX = 10000;

  // Aggregate used capacity per factory+date
  const usedMap = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.factoryId}__${a.productionDate.toISOString()}`;
    usedMap.set(key, (usedMap.get(key) ?? 0) + a.assignedQuantity);
  }

  const result: SeedDailyCapacity[] = [];
  for (const f of factories) {
    // Build records for June 2026 (2026-06-01 to 2026-06-30)
    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-06-${String(day).padStart(2, "0")}`;
      const dateObj = d(dateStr);
      const key = `${f.id}__${dateObj.toISOString()}`;
      const used = usedMap.get(key) ?? 0;

      result.push({
        factoryId: f.id,
        date: dateObj,
        maxCapacity: MAX,
        curCapacity: MAX - used,
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function cleanupStaleState() {
  console.log("  Cleaning stale state…");

  const eventsDeleted = await prisma.conflictIssueEvent.deleteMany({});
  const commentsDeleted = await prisma.conflictIssueComment.deleteMany({});
  const issuesDeleted = await prisma.conflictIssue.deleteMany({});

  const assignmentsDeleted = await prisma.orderAssignment.deleteMany({});
  const ordersDeleted = await prisma.order.deleteMany({});
  const capacitiesDeleted = await prisma.dailyCapacity.deleteMany({});

  const legacySalesDeleted = await prisma.user.deleteMany({
    where: { id: { in: ["sales-A", "sales-B", "sales-C"] } },
  });

  const legacySuperAdminsDeleted = await prisma.user.deleteMany({
    where: { id: { in: ["sa-A", "sa-B", "sa-C"] } },
  });

  console.log(
    `  Deleted: events=${eventsDeleted.count}, comments=${commentsDeleted.count}, ` +
      `issues=${issuesDeleted.count}, assignments=${assignmentsDeleted.count}, ` +
      `orders=${ordersDeleted.count}, capacities=${capacitiesDeleted.count}, ` +
      `legacySales=${legacySalesDeleted.count}, legacySuperAdmins=${legacySuperAdminsDeleted.count}`,
  );
}

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
        isFixed: o.isFixed,
        isPrioritized: o.isPrioritized,
      },
      update: {
        name: o.name,
        type: o.type,
        quantity: o.quantity,
        dueDate: o.dueDate,
        applicant: { connect: { id: o.applicantId } },
        status: o.status,
        isFixed: o.isFixed,
        isPrioritized: o.isPrioritized,
      },
    });
  }
}

async function seedAssignments(assignments: SeedAssignment[]) {
  console.log(`  Upserting ${assignments.length} assignments…`);
  for (const a of assignments) {
    const dummyCompletionDate = new Date(a.productionDate);
    dummyCompletionDate.setUTCDate(dummyCompletionDate.getUTCDate() + 1);

    await prisma.orderAssignment.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        order: { connect: { id: a.orderId } },
        factory: { connect: { id: a.factoryId } },
        productionDate: a.productionDate,
        completionDate: dummyCompletionDate,
        assignedQuantity: a.assignedQuantity,
        status: a.status,
      },
      update: {
        order: { connect: { id: a.orderId } },
        factory: { connect: { id: a.factoryId } },
        productionDate: a.productionDate,
        completionDate: dummyCompletionDate,
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

async function seedSystemAndConfigs() {
  console.log(`  Upserting SystemState (Simulation settings)...`);
  await prisma.systemState.upsert({
    where: { id: "global" },
    update: {
      isSimulationMode: false,
      simulationDate: new Date("2026-06-03T00:00:00.000Z"),
    },
    create: {
      id: "global",
      isSimulationMode: false,
      simulationDate: new Date("2026-06-03T00:00:00.000Z"),
    },
  });

  console.log(`  Upserting SYSTEM user and AutoSchedulerConfigs…`);
  const systemUser = await prisma.user.upsert({
    where: { email: "system@wafer.com" },
    update: {},
    create: {
      id: "system-user",
      email: "system@wafer.com",
      username: "AutoScheduler",
      role: "SYSTEM",
      group: "SYSTEM",
      failedLoginCount: 0,
    },
  });
  console.log(`  Upserted SYSTEM user: ${systemUser.email}`);

  const defaultTypes = ["A", "B", "C"];
  for (const type of defaultTypes) {
    await prisma.autoSchedulerConfig.upsert({
      where: { type },
      update: {},
      create: {
        type,
        isOperating: true,
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GAP_FILLING",
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      },
    });
  }
  console.log(
    `  Upserted AutoSchedulerConfigs for types: ${defaultTypes.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🌱 Starting seed…");

  const users = buildUsers();
  const factories = buildFactories();
  const { orders, assignments } = generateOrdersAndAssignments();
  const capacities = buildDailyCapacities(factories, assignments);

  await cleanupStaleState();
  // Seed system configs FIRST so partial crashes don't trigger real-time cron jobs
  await seedSystemAndConfigs();
  await seedUsers(users);
  await seedFactories(factories);
  await seedOrders(orders);
  await seedAssignments(assignments);
  await seedDailyCapacities(capacities);

  console.log("");
  console.log("✅ Seed complete.");
  console.log("");
  console.log("Simulation Scenario Activated: 2026-06-03");
  console.log("  - Rule 3: 2026-06-03 capacity 100% filled (IN_PRODUCTION)");
  console.log(
    "  - Rule 4: 2026-06-04 to 06-10 scheduled with 1000 remaining per day",
  );
  console.log(
    "  - Rule 6 Guaranteed Failure: 105 PENDING orders (total 262.5k) vs 243k absolute remaining cap.",
  );
  console.log(
    "  Running schedule engine should trigger exactly 2-3 failures per type.",
  );
  console.log("");
  console.log(
    "Seed orders: applicantId rotates sales-1 → … → sales-10 (equal counts; order type is independent).",
  );
  console.log("Login examples:");
  console.log("  username sa-A      password Password123!");
  console.log("  username admin-A1  password Password123!");
  console.log("  username sales-1 … sales-10   password Password123!");
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
