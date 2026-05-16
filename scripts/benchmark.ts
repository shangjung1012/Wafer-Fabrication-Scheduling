import {
  greedyBestFitStrategy,
  type SchedulingCapacityInput,
  type SchedulingFactoryInput,
  type SchedulingOrderInput,
  type SchedulingConfig,
} from "../modules/schedule/strategy";
import { OrderStatus } from "../lib/generated/prisma/client";

// Helpers
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

console.log("🚀 Starting Benchmark: Greedy Best-Fit Strategy");

const NUM_ORDERS = 10000;
const NUM_FACTORIES = 50;
const DAYS_OF_CAPACITY = 180;
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

console.log(`\n📦 Generating Mock Data:
- ${NUM_ORDERS} Orders
- ${NUM_FACTORIES} Factories
- ${DAYS_OF_CAPACITY} Days of Capacity per Factory (${NUM_FACTORIES * DAYS_OF_CAPACITY} records)`);

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

// 3. Generate Orders
const mockOrders: SchedulingOrderInput[] = [];
for (let i = 1; i <= NUM_ORDERS; i++) {
  // Due date between tomorrow and 180 days
  const dueDays = randomInt(1, DAYS_OF_CAPACITY - 1);

  mockOrders.push({
    id: `O${i}`,
    status: OrderStatus.APPROVED,
    dueDate: addDays(TODAY, dueDays),
    quantity: randomInt(100, 2000),
    createdAt: new Date(TODAY.getTime() - randomInt(0, 1000000000)), // Random created time in the past
    assignments: [],
  });
}

console.log("\n✅ Data Generation Complete. Running strategy...");

// Measure performance
const startTime = performance.now();

const strategyResult = greedyBestFitStrategy.execute(
  mockOrders,
  mockFactories,
  mockCapacities,
  {
    startDate: addDays(TODAY, 1),
    frozenDays: 0,
    productionDays: 1,
    bufferDays: 0,
    reschedulePolicy: "GAP_FILLING",
    algorithm: "GREEDY_BEST_FIT",
    splittable: true,
  } as SchedulingConfig,
  TODAY,
);

const endTime = performance.now();
const executionTimeMs = (endTime - startTime).toFixed(2);

console.log("\n📊 Benchmark Results:");
console.log(`⏱️  Execution Time: ${executionTimeMs} ms`);

const scheduledCount = strategyResult.processedOrders.filter(
  (o) => o.status === OrderStatus.SCHEDULED,
).length;
const approvedCount = strategyResult.processedOrders.filter(
  (o) => o.status === OrderStatus.APPROVED,
).length;

console.log(
  `📈 Total Orders Processed: ${strategyResult.processedOrders.length}`,
);
console.log(`✅ Successfully Scheduled Orders: ${scheduledCount}`);
console.log(`❌ Failed to Schedule (Rollback): ${approvedCount}`);
console.log(
  `📝 Total Virtual Assignments Created: ${strategyResult.newAssignments.length}`,
);
console.log(
  `🔄 Total Capacity Records Updated: ${strategyResult.updatedCapacities.length}`,
);
console.log(
  `➕ Total Dynamic Capacity Records Created: ${strategyResult.newCapacities.length}`,
);

console.log("\n🔍 Running Invariant Checks...");

// Check 1: Capacity Limit
for (const cap of strategyResult.updatedCapacities) {
  if (cap.curCapacity < 0) {
    throw new Error(
      `Invariant failed: Updated capacity record ${cap.id} has negative curCapacity (${cap.curCapacity})`,
    );
  }
}
for (const cap of strategyResult.newCapacities) {
  if (cap.curCapacity < 0) {
    throw new Error(
      `Invariant failed: Dynamically created capacity record for factory ${cap.factoryId} on ${cap.date} has negative curCapacity (${cap.curCapacity})`,
    );
  }
}

// Check 2: Quantity Conservation
for (const order of strategyResult.processedOrders) {
  if (order.status === OrderStatus.SCHEDULED) {
    const assignmentsForOrder = strategyResult.newAssignments.filter(
      (a) => a.orderId === order.id,
    );
    const assignedSum = assignmentsForOrder.reduce(
      (sum, a) => sum + a.assignedQuantity,
      0,
    );

    // In our benchmark, orders start with no prior assignments, so total quantity should equal the new assigned sum
    if (assignedSum !== order.quantity) {
      throw new Error(
        `Invariant failed: Order ${order.id} has quantity ${order.quantity} but was assigned ${assignedSum}`,
      );
    }
  }
}

console.log("✅ All invariant checks passed successfully.");

console.log("\n🎉 Benchmark Finished.");
