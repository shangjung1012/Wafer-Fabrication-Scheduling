/**
 * scripts/db-stress.ts
 *
 * End-to-end DB stress test for the scheduling engine.
 * Run with: pnpm db:stress
 *
 * Requires:
 *   - Postgres + Redis running (docker compose up -d)
 *   - stress-operator user exists: pnpm db:stress:seed
 *
 * Seeds deterministic Seed=42 BENCHMARK data, runs the full
 * prepareSchedulingData → strategy → _applyScheduleTransaction cycle,
 * then reads back from DB and verifies 7 invariants + metrics against benchmark.md.
 */

process.env.TZ = "UTC";

import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  OrderStatus,
  AssignmentStatus,
  FactoryStatus,
  UserRole,
} from "../lib/generated/prisma/client";
import {
  prepareSchedulingData,
  _applyScheduleTransaction,
} from "../modules/schedule/core";
import { greedyBestFitStrategy } from "../modules/schedule/strategy";
import { withScheduleLock } from "../infra/redis/schedule-store";
import { getRedis } from "../lib/redis";
import type { SchedulingConfig } from "../modules/schedule/strategy";
import { calculateOrderDeadline } from "../modules/schedule/validation-utils";

// ---------------------------------------------------------------------------
// Prisma client
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TODAY = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ),
);

function addDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function hr() {
  console.log("═".repeat(62));
}

// ---------------------------------------------------------------------------
// Benchmark constants
// ---------------------------------------------------------------------------

const BENCHMARK_TYPE = "BENCHMARK";
const BM_NUM_ORDERS = 24_000;
const BM_NUM_FIXED = 50;
const BM_NUM_FACTORIES = 20;
const BM_DAYS = 180;
const BM_CAPACITY = 10_000;

// Expected values from benchmark.md (Seed=42, deterministic)
const BM_EXPECTED = {
  scheduled: 23_023,
  failed: 977,
  successRate: "95.9",
  capacityUtil: "81.2",
};

// ---------------------------------------------------------------------------
// PRNG — Mulberry32, must match benchmark.ts call order exactly
// ---------------------------------------------------------------------------

function bmPrng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bmRandInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Seed BENCHMARK data
// ---------------------------------------------------------------------------

async function seedBenchmarkData(
  operatorId: string,
): Promise<{ factoryIds: string[] }> {
  console.log("  Seeding BENCHMARK data (Seed=42, 24k mutable + 50 fixed)...");

  await prisma.$executeRaw`DELETE FROM "order_assignment" WHERE "orderId" IN (SELECT id FROM "order" WHERE type = ${"BENCHMARK"})`;
  await prisma.$executeRaw`DELETE FROM "conflict_issue"   WHERE "orderId" IN (SELECT id FROM "order" WHERE type = ${"BENCHMARK"})`;
  await prisma.$executeRaw`DELETE FROM "order"            WHERE type = ${"BENCHMARK"}`;
  await prisma.$executeRaw`DELETE FROM "daily_capacity"   WHERE "factoryId" IN (SELECT id FROM "factory" WHERE "productionType" = ${"BENCHMARK"})`;
  await prisma.$executeRaw`DELETE FROM "_FactoryAdmins"   WHERE "A" IN (SELECT id FROM "factory" WHERE "productionType" = ${"BENCHMARK"})`;
  await prisma.$executeRaw`DELETE FROM "factory"          WHERE "productionType" = ${"BENCHMARK"}`;

  const factoryIds: string[] = [];
  for (let i = 0; i < BM_NUM_FACTORIES; i++) {
    const f = await prisma.factory.create({
      data: {
        productionType: BENCHMARK_TYPE,
        maxCapacity: BM_CAPACITY,
        status: FactoryStatus.ACTIVE,
      },
    });
    factoryIds.push(f.id);
  }

  // Full capacity — no pre-deduction for fixed orders, matching benchmark.ts behaviour
  const capBuf: {
    factoryId: string;
    date: Date;
    maxCapacity: number;
    curCapacity: number;
  }[] = [];
  for (const fid of factoryIds) {
    for (let d = 0; d < BM_DAYS; d++) {
      capBuf.push({
        factoryId: fid,
        date: addDays(TODAY, d),
        maxCapacity: BM_CAPACITY,
        curCapacity: BM_CAPACITY,
      });
    }
  }
  for (let i = 0; i < capBuf.length; i += 500) {
    await prisma.dailyCapacity.createMany({ data: capBuf.slice(i, i + 500) });
  }

  // PRNG call order: mutable orders (4 calls each) then fixed orders (3 calls each)
  const rng = bmPrng(42);
  const ri = (min: number, max: number) => bmRandInt(rng, min, max);

  const mutableBuf: object[] = [];
  for (let i = 1; i <= BM_NUM_ORDERS; i++) {
    const dueDays = ri(2, BM_DAYS - 1);
    const quantity = ri(25, 2500);
    const createdAtOffset = ri(0, 1_000_000_000);
    const isPrioritized = rng() < 0.05;
    mutableBuf.push({
      id: `BENCHMARK-M-${String(i).padStart(6, "0")}`,
      name: `Benchmark Order ${i}`,
      type: BENCHMARK_TYPE,
      quantity,
      dueDate: addDays(TODAY, dueDays),
      createdAt: new Date(TODAY.getTime() - createdAtOffset),
      applicantId: operatorId,
      lastModifiedById: operatorId,
      status: OrderStatus.PENDING,
      isPrioritized,
      isFixed: false,
    });
  }

  const fixedBuf: object[] = [];
  const fixedAsgBuf: object[] = [];
  for (let i = 1; i <= BM_NUM_FIXED; i++) {
    const factoryIdx = ri(0, BM_NUM_FACTORIES - 1);
    const day = ri(1, 30);
    const qty = ri(50, 500);
    const orderId = `BENCHMARK-F-${String(i).padStart(3, "0")}`;
    fixedBuf.push({
      id: orderId,
      name: `Benchmark Fixed ${i}`,
      type: BENCHMARK_TYPE,
      quantity: qty,
      dueDate: addDays(TODAY, day + 30),
      createdAt: TODAY,
      applicantId: operatorId,
      lastModifiedById: operatorId,
      status: OrderStatus.SCHEDULED,
      isPrioritized: false,
      isFixed: true,
    });
    fixedAsgBuf.push({
      orderId,
      factoryId: factoryIds[factoryIdx],
      productionDate: addDays(TODAY, day),
      completionDate: addDays(TODAY, day + 1),
      assignedQuantity: qty,
      status: AssignmentStatus.SCHEDULED,
    });
  }

  for (let i = 0; i < mutableBuf.length; i += 500) {
    await prisma.order.createMany({
      data: mutableBuf.slice(i, i + 500) as never[],
    });
  }
  await prisma.order.createMany({ data: fixedBuf as never[] });
  await prisma.orderAssignment.createMany({ data: fixedAsgBuf as never[] });

  console.log(
    `  Done: ${BM_NUM_ORDERS} mutable + ${BM_NUM_FIXED} fixed, ${factoryIds.length} factories.\n`,
  );
  return { factoryIds };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n🔥 DB End-to-End Benchmark");
  console.log(
    `   DB: ${process.env.DATABASE_URL?.replace(/:\/\/.*@/, "://<credentials>@")}`,
  );
  console.log();

  const operator = await prisma.user.upsert({
    where: { username: "stress-operator" },
    update: {},
    create: {
      username: "stress-operator",
      email: "stress-operator@stress.internal",
      password: "not-a-real-hash",
      role: UserRole.SUPERADMIN,
    },
  });

  const { factoryIds } = await seedBenchmarkData(operator.id);

  const bmConfig: SchedulingConfig = {
    startDate: addDays(TODAY, 1),
    frozenDays: 0,
    productionDays: 1,
    bufferDays: 0,
    reschedulePolicy: "GAP_FILLING",
    algorithm: "GREEDY_BEST_FIT",
    splittable: true,
  };

  hr();
  console.log("  End-to-End DB Benchmark (Seed=42 — must match benchmark.md)");
  hr();

  // ── prepareSchedulingData ────────────────────────────────────────────────
  const t0read = performance.now();
  const prepared = await prepareSchedulingData(
    BENCHMARK_TYPE,
    { ...bmConfig },
    TODAY,
    true,
  );
  console.log(
    `  prepareSchedulingData: ${fmt(performance.now() - t0read)}  |  Orders: ${prepared.orders.length}  |  Capacities: ${prepared.capacities.length}`,
  );

  // ── Strategy (in-memory) ─────────────────────────────────────────────────
  const t0strat = performance.now();
  const stratResult = greedyBestFitStrategy.execute(
    prepared.orders,
    prepared.factories,
    prepared.capacities,
    bmConfig,
    TODAY,
  );
  const stratMs = performance.now() - t0strat;

  const inMemScheduled = stratResult.processedOrders.filter(
    (o) => o.status === OrderStatus.SCHEDULED && !o.isFixed,
  ).length;
  const inMemFailed = stratResult.processedOrders.filter(
    (o) => o.status === OrderStatus.FAILED,
  ).length;
  console.log(
    `  Strategy:             ${fmt(stratMs)}  |  Scheduled: ${inMemScheduled}  |  Failed: ${inMemFailed}`,
  );

  // ── _applyScheduleTransaction ────────────────────────────────────────────
  const t0write = performance.now();
  try {
    await withScheduleLock(BENCHMARK_TYPE, async () => {
      await _applyScheduleTransaction(
        BENCHMARK_TYPE,
        bmConfig,
        stratResult,
        operator.id,
      );
    });
  } catch (e) {
    console.error(`  ❌ Transaction threw: ${e}`);
    process.exit(1);
  }
  const writeMs = performance.now() - t0write;
  console.log(`  Transaction:          ${fmt(writeMs)}\n`);

  // ── Read back from DB ────────────────────────────────────────────────────
  const dbOrders = await prisma.order.findMany({
    where: { type: BENCHMARK_TYPE },
    select: {
      id: true,
      status: true,
      quantity: true,
      dueDate: true,
      isFixed: true,
      isPrioritized: true,
      assignments: {
        select: {
          factoryId: true,
          productionDate: true,
          assignedQuantity: true,
        },
      },
    },
  });
  const dbCaps = await prisma.dailyCapacity.findMany({
    where: { factoryId: { in: factoryIds } },
    select: { factoryId: true, curCapacity: true, maxCapacity: true },
  });

  // ── 7 Invariant checks ───────────────────────────────────────────────────
  let invPassed = 0;

  const negCap = dbCaps.find((c) => c.curCapacity < 0);
  if (!negCap) {
    invPassed++;
    console.log("  ✅ [1/7] Capacity Non-Negative");
  } else {
    console.log(
      `  ❌ [1/7] Capacity Non-Negative — curCapacity=${negCap.curCapacity}`,
    );
  }

  const overCap = dbCaps.find((c) => c.curCapacity > c.maxCapacity);
  if (!overCap) {
    invPassed++;
    console.log("  ✅ [2/7] Capacity Not Exceeding Max");
  } else {
    console.log(
      `  ❌ [2/7] Capacity Not Exceeding Max — ${overCap.curCapacity} > ${overCap.maxCapacity}`,
    );
  }

  let qtyFail: string | null = null;
  for (const o of dbOrders.filter(
    (o) => o.status === OrderStatus.SCHEDULED && !o.isFixed,
  )) {
    const total = o.assignments.reduce((s, a) => s + a.assignedQuantity, 0);
    if (total !== o.quantity) {
      qtyFail = `${o.id}: expected ${o.quantity} got ${total}`;
      break;
    }
  }
  if (!qtyFail) {
    invPassed++;
    console.log("  ✅ [3/7] Quantity Conservation");
  } else {
    console.log(`  ❌ [3/7] Quantity Conservation — ${qtyFail}`);
  }

  let windowFail = 0;
  for (const o of dbOrders) {
    if (o.isFixed) continue;
    const deadline = calculateOrderDeadline(new Date(o.dueDate), bmConfig);
    for (const a of o.assignments) {
      const pd = new Date(a.productionDate);
      if (pd < bmConfig.startDate || pd > deadline) windowFail++;
    }
  }
  if (windowFail === 0) {
    invPassed++;
    console.log("  ✅ [4/7] Time Window Compliance");
  } else {
    console.log(`  ❌ [4/7] Time Window Compliance — ${windowFail} violations`);
  }

  const failedWithAsgn = dbOrders.filter(
    (o) => o.status === OrderStatus.FAILED && o.assignments.length > 0,
  );
  if (failedWithAsgn.length === 0) {
    invPassed++;
    console.log("  ✅ [5/7] Rollback Completeness");
  } else {
    console.log(
      `  ❌ [5/7] Rollback Completeness — ${failedWithAsgn.length} FAILED orders have assignments`,
    );
  }

  const fixedNotScheduled = dbOrders.filter(
    (o) => o.isFixed && o.status !== OrderStatus.SCHEDULED,
  );
  if (fixedNotScheduled.length === 0) {
    invPassed++;
    console.log("  ✅ [6/7] Immutable Order Protection");
  } else {
    console.log(
      `  ❌ [6/7] Immutable Order Protection — ${fixedNotScheduled.length} fixed orders changed status`,
    );
  }

  let seenNonPrio = false;
  let prioViolation: string | null = null;
  for (const o of stratResult.processedOrders.filter((o) => !o.isFixed)) {
    if (o.isPrioritized) {
      if (seenNonPrio) {
        prioViolation = o.id;
        break;
      }
    } else {
      seenNonPrio = true;
    }
  }
  if (!prioViolation) {
    invPassed++;
    console.log("  ✅ [7/7] Prioritized Processing Order");
  } else {
    console.log(
      `  ❌ [7/7] Prioritized Processing Order — order ${prioViolation}`,
    );
  }

  console.log(`\n  Invariant Pass Rate: ${invPassed}/7`);

  // ── Metrics vs benchmark.md ──────────────────────────────────────────────
  const mutableInDB = dbOrders.filter((o) => !o.isFixed);
  const scheduledCount = mutableInDB.filter(
    (o) => o.status === OrderStatus.SCHEDULED,
  ).length;
  const failedCount = mutableInDB.filter(
    (o) => o.status === OrderStatus.FAILED,
  ).length;
  const successRate = ((scheduledCount / BM_NUM_ORDERS) * 100).toFixed(1);
  const totalAssigned = dbOrders
    .flatMap((o) => o.assignments)
    .reduce((s, a) => s + a.assignedQuantity, 0);
  const utilization = (
    (totalAssigned / (BM_NUM_FACTORIES * BM_CAPACITY * (BM_DAYS - 1))) *
    100
  ).toFixed(1);

  const chk = (label: string, got: string | number, exp: string | number) =>
    `  ${String(got) === String(exp) ? "✅" : "❌"} ${label}: ${got} (expected ${exp})`;

  console.log("\n  DB metrics vs benchmark.md:");
  console.log(chk("Scheduled", scheduledCount, BM_EXPECTED.scheduled));
  console.log(chk("Failed", failedCount, BM_EXPECTED.failed));
  console.log(
    chk("Success Rate", successRate + "%", BM_EXPECTED.successRate + "%"),
  );
  console.log(
    chk("Capacity Util", utilization + "%", BM_EXPECTED.capacityUtil + "%"),
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log();
  hr();
  console.log("  SUMMARY");
  hr();

  const metricsOk =
    scheduledCount === BM_EXPECTED.scheduled &&
    failedCount === BM_EXPECTED.failed;
  const allPassed = invPassed === 7 && metricsOk;

  if (allPassed) {
    console.log(`  ✅ All checks passed`);
    console.log(
      `     Invariants: 7/7  |  Scheduled: ${scheduledCount}/${BM_NUM_ORDERS}  |  Write: ${fmt(writeMs)}`,
    );
    console.log();
    console.log("🎉 DB End-to-End Benchmark passed.");
  } else {
    console.log(
      `  ❌ Invariants: ${invPassed}/7  |  Metrics match: ${metricsOk}`,
    );
    console.log();
    console.error("💥 DB End-to-End Benchmark FAILED — see ❌ above.");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getRedis().quit();
    await prisma.$disconnect();
    await pool.end();
  });
