import {
  greedyBestFitStrategy,
  computeTotalAvailableCapacity,
  type SchedulingCapacityInput,
  type SchedulingFactoryInput,
  type SchedulingOrderInput,
  type SchedulingConfig,
  type CapacityDraft,
} from "../modules/schedule/strategy";
import { calculateOrderDeadline } from "../modules/schedule/validation-utils";
import { OrderStatus, AssignmentStatus } from "../lib/generated/prisma/client";

// Seeded PRNG (Mulberry32) — deterministic results across runs
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 42;
const random = mulberry32(SEED);

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function toDateString(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================================

console.log("🚀 Starting Benchmark: Greedy Best-Fit Strategy");
console.log(`   Seed: ${SEED} (deterministic)\n`);

const NUM_ORDERS = 10000;
const NUM_FIXED_ORDERS = 50;
const NUM_FACTORIES = 50;
const DAYS_OF_CAPACITY = 180;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const config: SchedulingConfig = {
  startDate: addDays(TODAY, 1),
  frozenDays: 0,
  productionDays: 1,
  bufferDays: 0,
  reschedulePolicy: "GAP_FILLING",
  algorithm: "GREEDY_BEST_FIT",
  splittable: true,
};

console.log(`📦 Generating Mock Data:`);
console.log(
  `   ${NUM_ORDERS} Mutable Orders (~10% isPrioritized)`,
);
console.log(
  `   ${NUM_FIXED_ORDERS} Fixed Orders (isFixed=true, pre-assigned)`,
);
console.log(`   ${NUM_FACTORIES} Factories`);
console.log(
  `   ${DAYS_OF_CAPACITY} Days × ${NUM_FACTORIES} Factories = ${NUM_FACTORIES * DAYS_OF_CAPACITY} Capacity Records`,
);

// 1. Generate Factories
const mockFactories: SchedulingFactoryInput[] = [];
for (let i = 1; i <= NUM_FACTORIES; i++) {
  mockFactories.push({
    id: `F${i}`,
    maxCapacity: randomInt(1000, 5000),
  });
}

// 2. Generate Capacities
const mockCapacities: SchedulingCapacityInput[] = [];
for (const factory of mockFactories) {
  for (let day = 0; day < DAYS_OF_CAPACITY; day++) {
    const targetDate = addDays(TODAY, day);
    mockCapacities.push({
      id: `C_${factory.id}_${day}`,
      factoryId: factory.id,
      date: targetDate,
      maxCapacity: factory.maxCapacity,
      curCapacity: factory.maxCapacity,
    });
  }
}

// 3. Generate Mutable Orders
const mockOrders: SchedulingOrderInput[] = [];
for (let i = 1; i <= NUM_ORDERS; i++) {
  const dueDays = randomInt(1, DAYS_OF_CAPACITY - 1);
  mockOrders.push({
    id: `O${i}`,
    status: OrderStatus.PENDING,
    dueDate: addDays(TODAY, dueDays),
    quantity: randomInt(100, 2000),
    createdAt: new Date(TODAY.getTime() - randomInt(0, 1000000000)),
    isFixed: false,
    isPrioritized: random() < 0.1,
    assignments: [],
  });
}

// 4. Generate Fixed Orders with pre-existing assignments
for (let i = 1; i <= NUM_FIXED_ORDERS; i++) {
  const factory = mockFactories[randomInt(0, NUM_FACTORIES - 1)];
  const day = randomInt(1, 30);
  const qty = randomInt(50, 500);
  const prodDate = addDays(TODAY, day);

  mockOrders.push({
    id: `FIXED_${i}`,
    status: OrderStatus.SCHEDULED,
    dueDate: addDays(TODAY, day + 30),
    quantity: qty,
    createdAt: TODAY,
    isFixed: true,
    isPrioritized: false,
    assignments: [
      {
        status: AssignmentStatus.SCHEDULED,
        assignedQuantity: qty,
        factoryId: factory.id,
        productionDate: prodDate,
      },
    ],
  });
}

console.log("\n✅ Data Generation Complete. Running strategy...");

// --- Execute ---
const startTime = performance.now();

const strategyResult = greedyBestFitStrategy.execute(
  mockOrders,
  mockFactories,
  mockCapacities,
  config,
  TODAY,
);

const endTime = performance.now();
const executionTimeMs = (endTime - startTime).toFixed(2);

// --- Basic Counts ---
const scheduledOrders = strategyResult.processedOrders.filter(
  (o) => o.status === OrderStatus.SCHEDULED,
);
const failedOrders = strategyResult.processedOrders.filter(
  (o) => o.status === OrderStatus.FAILED,
);
const scheduledCount = scheduledOrders.length;
const failedCount = failedOrders.length;

console.log(`\n📊 Execution Results:`);
console.log(`   ⏱️  Execution Time:       ${executionTimeMs} ms`);
console.log(
  `   📈 Orders Processed:      ${strategyResult.processedOrders.length}`,
);
console.log(`   ✅ Scheduled:             ${scheduledCount}`);
console.log(`   ❌ Failed:                ${failedCount}`);
console.log(
  `   📝 Assignments Created:   ${strategyResult.newAssignments.length}`,
);
console.log(
  `   🔄 Capacities Updated:    ${strategyResult.updatedCapacities.length}`,
);
console.log(
  `   ➕ Capacities Created:    ${strategyResult.newCapacities.length}`,
);

// ============================================================
// SECTION 1: INVARIANT CHECKS (Constraint Satisfaction)
//   6 properties that must ALWAYS hold regardless of input.
//   Any violation = algorithm bug.
// ============================================================
console.log("\n" + "═".repeat(60));
console.log("  SECTION 1: INVARIANT CHECKS (Constraint Satisfaction)");
console.log("═".repeat(60));

let invariantsPassed = 0;
const totalInvariants = 6;

// [1] Capacity Non-Negative — no factory-day overallocated
let pass = true;
for (const cap of [
  ...strategyResult.updatedCapacities,
  ...strategyResult.newCapacities,
]) {
  if (cap.curCapacity < 0) {
    console.error(
      `  ❌ [1/6] Capacity Non-Negative — ${cap.id ?? cap.factoryId} has curCapacity=${cap.curCapacity}`,
    );
    pass = false;
    break;
  }
}
if (pass) {
  invariantsPassed++;
  console.log("  ✅ [1/6] Capacity Non-Negative");
}

// [2] Capacity Not Exceeding Max — rollback didn't over-restore
pass = true;
for (const cap of [
  ...strategyResult.updatedCapacities,
  ...strategyResult.newCapacities,
]) {
  if (cap.curCapacity > cap.maxCapacity) {
    console.error(
      `  ❌ [2/6] Capacity ≤ Max — ${cap.id ?? cap.factoryId}: ${cap.curCapacity} > ${cap.maxCapacity}`,
    );
    pass = false;
    break;
  }
}
if (pass) {
  invariantsPassed++;
  console.log("  ✅ [2/6] Capacity Not Exceeding Max");
}

// [3] Quantity Conservation — SCHEDULED orders fully assigned, no more no less
pass = true;
for (const order of strategyResult.processedOrders) {
  if (order.status !== OrderStatus.SCHEDULED || order.isFixed) continue;
  const newQty = strategyResult.newAssignments
    .filter((a) => a.orderId === order.id)
    .reduce((sum, a) => sum + a.assignedQuantity, 0);
  const existingQty = (order.assignments || []).reduce(
    (sum, a) => sum + a.assignedQuantity,
    0,
  );
  if (existingQty + newQty !== order.quantity) {
    console.error(
      `  ❌ [3/6] Quantity Conservation — Order ${order.id}: expected ${order.quantity}, got ${existingQty + newQty}`,
    );
    pass = false;
    break;
  }
}
if (pass) {
  invariantsPassed++;
  console.log("  ✅ [3/6] Quantity Conservation");
}

// [4] Time Window Compliance — all assignments within [startDate, deadline]
pass = true;
let windowViolations = 0;
for (const assignment of strategyResult.newAssignments) {
  const order = strategyResult.processedOrders.find(
    (o) => o.id === assignment.orderId,
  );
  if (!order) continue;

  const prodStr = toDateString(assignment.productionDate);
  const startStr = toDateString(config.startDate);
  const deadline = calculateOrderDeadline(new Date(order.dueDate), config);
  const deadlineStr = toDateString(deadline);

  if (prodStr < startStr || prodStr > deadlineStr) {
    windowViolations++;
    pass = false;
  }
}
if (pass) {
  invariantsPassed++;
  console.log("  ✅ [4/6] Time Window Compliance");
} else {
  console.error(
    `  ❌ [4/6] Time Window Compliance — ${windowViolations} violations`,
  );
}

// [5] Rollback Completeness — FAILED orders have zero new assignments
const failedIds = new Set(failedOrders.map((o) => o.id));
const orphaned = strategyResult.newAssignments.filter((a) =>
  failedIds.has(a.orderId),
);
if (orphaned.length === 0) {
  invariantsPassed++;
  console.log("  ✅ [5/6] Rollback Completeness");
} else {
  console.error(
    `  ❌ [5/6] Rollback Completeness — ${orphaned.length} orphaned assignments for FAILED orders`,
  );
}

// [6] Immutable Order Protection — isFixed orders unchanged, no new assignments
pass = true;
for (const original of mockOrders.filter((o) => o.isFixed)) {
  const processed = strategyResult.processedOrders.find(
    (o) => o.id === original.id,
  );
  if (!processed) {
    console.error(
      `  ❌ [6/6] Immutable Protection — Fixed order ${original.id} missing from results`,
    );
    pass = false;
    break;
  }
  if (processed.status !== original.status) {
    console.error(
      `  ❌ [6/6] Immutable Protection — Fixed order ${original.id}: ${original.status} → ${processed.status}`,
    );
    pass = false;
    break;
  }
  if (strategyResult.newAssignments.some((a) => a.orderId === original.id)) {
    console.error(
      `  ❌ [6/6] Immutable Protection — Fixed order ${original.id} has unexpected new assignments`,
    );
    pass = false;
    break;
  }
}
if (pass) {
  invariantsPassed++;
  console.log("  ✅ [6/6] Immutable Order Protection");
}

console.log(
  `\n  Invariant Pass Rate: ${invariantsPassed}/${totalInvariants}`,
);

// ============================================================
// SECTION 2: FAILURE JUSTIFICATION
//   For each FAILED order, categorize WHY it failed:
//   - Window Conflict: deadline is before startDate (impossible)
//   - Capacity Exhausted: final remaining capacity < quantity (consumed by others)
//   - Greedy Trade-off: capacity exists in final state but was consumed by
//     higher-priority orders when this order was processed (expected greedy behavior)
// ============================================================
console.log("\n" + "═".repeat(60));
console.log("  SECTION 2: FAILURE JUSTIFICATION");
console.log("═".repeat(60));

// Build final capacity map from strategy output
const finalCapacityMap = new Map<string, CapacityDraft>();
for (const cap of mockCapacities) {
  finalCapacityMap.set(`${cap.factoryId}_${toDateString(cap.date)}`, {
    ...cap,
  });
}
for (const cap of strategyResult.updatedCapacities) {
  finalCapacityMap.set(`${cap.factoryId}_${toDateString(cap.date)}`, {
    ...cap,
  });
}
for (const cap of strategyResult.newCapacities) {
  finalCapacityMap.set(`${cap.factoryId}_${toDateString(cap.date)}`, {
    ...cap,
  });
}

let windowConflict = 0;
let capacityExhausted = 0;
let greedyTradeoff = 0;

for (const order of failedOrders) {
  const windowStart = new Date(config.startDate);
  const windowEnd = calculateOrderDeadline(new Date(order.dueDate), config);

  if (windowStart.getTime() > windowEnd.getTime()) {
    windowConflict++;
    continue;
  }

  const existingQty = (order.assignments || []).reduce(
    (sum, a) => sum + a.assignedQuantity,
    0,
  );
  const remainingQty = order.quantity - existingQty;

  const remainingCapacity = computeTotalAvailableCapacity(
    windowStart,
    windowEnd,
    mockFactories,
    finalCapacityMap,
  );

  if (remainingCapacity < remainingQty) {
    capacityExhausted++;
  } else {
    greedyTradeoff++;
  }
}

console.log(
  `  Window Conflict (deadline < startDate):       ${windowConflict}`,
);
console.log(
  `  Capacity Exhausted (no room in final state):  ${capacityExhausted}`,
);
console.log(
  `  Greedy Trade-off (outprioritized by others):  ${greedyTradeoff}`,
);

const justifiedCount = windowConflict + capacityExhausted;
const justificationRate =
  failedCount > 0
    ? ((justifiedCount / failedCount) * 100).toFixed(1)
    : "N/A";
console.log(`\n  Failure Justification Rate: ${justificationRate}%`);
if (greedyTradeoff > 0) {
  console.log(
    `  Note: ${greedyTradeoff} Greedy Trade-off failures are expected behavior —`,
  );
  console.log(
    `        capacity was consumed by higher-priority orders during processing.`,
  );
}

// ============================================================
// SECTION 3: EFFICIENCY METRICS
// ============================================================
console.log("\n" + "═".repeat(60));
console.log("  SECTION 3: EFFICIENCY METRICS");
console.log("═".repeat(60));

const mutableOrders = strategyResult.processedOrders.filter(
  (o) => !o.isFixed,
);
const mutableScheduled = mutableOrders.filter(
  (o) => o.status === OrderStatus.SCHEDULED,
).length;
const successRate = ((mutableScheduled / mutableOrders.length) * 100).toFixed(
  1,
);

const totalAssigned = strategyResult.newAssignments.reduce(
  (sum, a) => sum + a.assignedQuantity,
  0,
);
let totalSystemCapacity = 0;
for (const factory of mockFactories) {
  totalSystemCapacity += factory.maxCapacity * (DAYS_OF_CAPACITY - 1);
}
const utilization = ((totalAssigned / totalSystemCapacity) * 100).toFixed(1);

const totalDemand = mutableOrders.reduce((sum, o) => sum + o.quantity, 0);
const theoreticalMax = Math.min(totalDemand, totalSystemCapacity);
const upperBoundGap = ((totalAssigned / theoreticalMax) * 100).toFixed(1);

console.log(
  `  Scheduling Success Rate:     ${successRate}% (${mutableScheduled}/${mutableOrders.length})`,
);
console.log(`  Capacity Utilization:        ${utilization}%`);
console.log(`  vs. Theoretical Upper Bound: ${upperBoundGap}%`);

// ============================================================
// SUMMARY
// ============================================================
console.log("\n" + "═".repeat(60));
console.log("  BENCHMARK SUMMARY");
console.log("═".repeat(60));
console.log(
  `  Scale:              ${mockOrders.length} orders × ${NUM_FACTORIES} factories × ${DAYS_OF_CAPACITY} days`,
);
console.log(`  Execution Time:     ${executionTimeMs} ms`);
console.log(
  `  Invariants:         ${invariantsPassed}/${totalInvariants} ${invariantsPassed === totalInvariants ? "✅" : "❌"}`,
);
console.log(`  Failure Justified:  ${justificationRate}%`);
console.log(`  Success Rate:       ${successRate}%`);
console.log(`  Utilization:        ${utilization}%`);
console.log("═".repeat(60));

if (invariantsPassed < totalInvariants) {
  console.error("\n💥 BENCHMARK FAILED: Invariant violations detected.");
  process.exit(1);
}

// ============================================================
// SECTION 4: RESCHEDULE POLICY COMPARISON
//   Two-phase experiment:
//   Phase 1 = the GAP_FILLING run above (baseline schedule)
//   Phase 2 = 2000 new orders arrive → run each policy, compare
// ============================================================
console.log("\n" + "═".repeat(60));
console.log("  SECTION 4: RESCHEDULE POLICY COMPARISON");
console.log("═".repeat(60));

// --- Phase 1 baseline (from the GAP_FILLING run above) ---
const phase1Scheduled = strategyResult.processedOrders.filter(
  (o) => o.status === OrderStatus.SCHEDULED && !o.isFixed,
);
const phase1Failed = strategyResult.processedOrders.filter(
  (o) => o.status === OrderStatus.FAILED,
);
const phase1ScheduledIds = new Set(phase1Scheduled.map((o) => o.id));

// Build phase 1 assignment lookup
const phase1Asgn = new Map<
  string,
  { factoryId: string; productionDate: Date; assignedQuantity: number }[]
>();
for (const a of strategyResult.newAssignments) {
  const list = phase1Asgn.get(a.orderId) || [];
  list.push({
    factoryId: a.factoryId,
    productionDate: a.productionDate,
    assignedQuantity: a.assignedQuantity,
  });
  phase1Asgn.set(a.orderId, list);
}

// Post-phase1 capacity state (for GAP_FILLING — existing allocations stay)
const postPhase1Caps: SchedulingCapacityInput[] = mockCapacities.map((cap) => {
  const updated = strategyResult.updatedCapacities.find((u) => u.id === cap.id);
  return updated ? { ...updated } : { ...cap };
});
for (const cap of strategyResult.newCapacities) {
  postPhase1Caps.push({
    ...cap,
    id: `DYN_${cap.factoryId}_${toDateString(cap.date)}`,
  });
}

// Generate 2000 new PENDING orders for phase 2
const NEW_ORDER_COUNT = 2000;
const phase2NewOrders: SchedulingOrderInput[] = [];
for (let i = 1; i <= NEW_ORDER_COUNT; i++) {
  const dueDays = randomInt(1, DAYS_OF_CAPACITY - 1);
  phase2NewOrders.push({
    id: `NEW_${i}`,
    status: OrderStatus.PENDING,
    dueDate: addDays(TODAY, dueDays),
    quantity: randomInt(100, 2000),
    createdAt: new Date(TODAY.getTime() - randomInt(0, 1000000000)),
    isFixed: false,
    isPrioritized: false,
    assignments: [],
  });
}
const newOrderIds = new Set(phase2NewOrders.map((o) => o.id));
const fixedOrdersCopy = mockOrders.filter((o) => o.isFixed);

console.log(`  Phase 1 baseline: ${phase1Scheduled.length} scheduled, ${phase1Failed.length} failed`);
console.log(`  Phase 2: +${NEW_ORDER_COUNT} new orders → run each policy\n`);

// --- Run each policy ---
type PolicyName = "GAP_FILLING" | "GLOBAL_OPTIMIZE" | "PRIORITY_RETAIN";
const policyNames: PolicyName[] = [
  "GAP_FILLING",
  "GLOBAL_OPTIMIZE",
  "PRIORITY_RETAIN",
];

interface PolicyMetrics {
  totalScheduled: number;
  totalFailed: number;
  newScheduled: number;
  retained: number;
  displaced: number;
  stability: number;
  ms: number;
}

const policyResults = new Map<PolicyName, PolicyMetrics>();

for (const policy of policyNames) {
  let orders: SchedulingOrderInput[];
  let caps: SchedulingCapacityInput[];

  if (policy === "GAP_FILLING") {
    // SCHEDULED orders keep their assignments → remainingQty = 0 → skipped
    // Capacity reflects existing allocations (post-phase1 state)
    orders = [
      ...phase1Scheduled.map((o) => ({
        ...o,
        assignments: (phase1Asgn.get(o.id) || []).map((a) => ({
          status: AssignmentStatus.SCHEDULED,
          assignedQuantity: a.assignedQuantity,
          factoryId: a.factoryId,
          productionDate: a.productionDate,
        })),
      })),
      ...phase1Failed.map((o) => ({ ...o, assignments: [] })),
      ...phase2NewOrders.map((o) => ({ ...o })),
      ...fixedOrdersCopy.map((o) => ({ ...o })),
    ];
    caps = postPhase1Caps.map((c) => ({ ...c }));
  } else {
    // GLOBAL_OPTIMIZE / PRIORITY_RETAIN: release all SCHEDULED capacity
    // Assignments stripped, capacity restored to full
    orders = [
      ...phase1Scheduled.map((o) => ({ ...o, assignments: [] })),
      ...phase1Failed.map((o) => ({ ...o, assignments: [] })),
      ...phase2NewOrders.map((o) => ({ ...o })),
      ...fixedOrdersCopy.map((o) => ({ ...o })),
    ];
    caps = mockCapacities.map((c) => ({ ...c }));
  }

  const policyConfig: SchedulingConfig = {
    ...config,
    reschedulePolicy: policy,
  };

  const t0 = performance.now();
  const res = greedyBestFitStrategy.execute(
    orders,
    mockFactories,
    caps,
    policyConfig,
    TODAY,
  );
  const t1 = performance.now();

  const sched = res.processedOrders.filter(
    (o) => o.status === OrderStatus.SCHEDULED,
  );
  const fail = res.processedOrders.filter(
    (o) => o.status === OrderStatus.FAILED,
  );

  policyResults.set(policy, {
    totalScheduled: sched.length,
    totalFailed: fail.length,
    newScheduled: sched.filter((o) => newOrderIds.has(o.id)).length,
    retained: sched.filter((o) => phase1ScheduledIds.has(o.id)).length,
    displaced: fail.filter((o) => phase1ScheduledIds.has(o.id)).length,
    stability:
      phase1Scheduled.length > 0
        ? (sched.filter((o) => phase1ScheduledIds.has(o.id)).length /
            phase1Scheduled.length) *
          100
        : 100,
    ms: Math.round(t1 - t0),
  });
}

// --- Print comparison table ---
const gf = policyResults.get("GAP_FILLING")!;
const go = policyResults.get("GLOBAL_OPTIMIZE")!;
const pr = policyResults.get("PRIORITY_RETAIN")!;

const COL = 16;
const row = (label: string, v1: string, v2: string, v3: string) =>
  `  ${label.padEnd(30)} ${v1.padStart(COL)} ${v2.padStart(COL)} ${v3.padStart(COL)}`;

console.log(
  row("", "GAP_FILLING", "GLOBAL_OPT", "PRIO_RETAIN"),
);
console.log("  " + "─".repeat(30 + COL * 3 + 3));
console.log(
  row(
    "Total Scheduled",
    `${gf.totalScheduled}`,
    `${go.totalScheduled}`,
    `${pr.totalScheduled}`,
  ),
);
console.log(
  row(
    "Total Failed",
    `${gf.totalFailed}`,
    `${go.totalFailed}`,
    `${pr.totalFailed}`,
  ),
);
console.log(
  row(
    `New Orders (/${NEW_ORDER_COUNT})`,
    `${gf.newScheduled}`,
    `${go.newScheduled}`,
    `${pr.newScheduled}`,
  ),
);
console.log(
  row(
    `Retained (/${phase1Scheduled.length})`,
    `${gf.retained}`,
    `${go.retained}`,
    `${pr.retained}`,
  ),
);
console.log(
  row(
    "Displaced",
    `${gf.displaced}`,
    `${go.displaced}`,
    `${pr.displaced}`,
  ),
);
console.log(
  row(
    "Stability",
    `${gf.stability.toFixed(1)}%`,
    `${go.stability.toFixed(1)}%`,
    `${pr.stability.toFixed(1)}%`,
  ),
);
console.log(
  row(
    "Execution (ms)",
    `${gf.ms}`,
    `${go.ms}`,
    `${pr.ms}`,
  ),
);

console.log(`
  Definitions:
  • Retained:  Phase 1 SCHEDULED orders that remain SCHEDULED in Phase 2
  • Displaced: Phase 1 SCHEDULED orders that became FAILED in Phase 2
  • Stability: Retained / Phase 1 Scheduled (higher = less churn)

  Key Takeaways:
  • GAP_FILLING:     Max stability — existing assignments never change
  • GLOBAL_OPTIMIZE: Max throughput — re-optimizes all, but existing orders may lose their slot
  • PRIORITY_RETAIN: Balanced — re-optimizes but keeps existing assignments first`);

console.log("\n🎉 Benchmark Finished — All Checks Passed.");
