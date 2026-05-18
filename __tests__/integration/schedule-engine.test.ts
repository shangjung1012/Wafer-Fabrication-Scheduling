import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runSchedule } from "@/modules/schedule/run";
import { type SchedulingConfig } from "@/modules/schedule/strategy";
import {
  OrderStatus,
  AssignmentStatus,
  UserRole,
} from "@/lib/generated/prisma/client";

// This file contains database integration tests.
// A real PostgreSQL database must be running and accessible via process.env.DATABASE_URL.

function isDatabaseUnreachable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Can't reach database server")
  );
}

describe("Schedule Engine - Database Integration", () => {
  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  beforeEach(async () => {
    try {
      // Clean up only data created by this suite (scoped by productionType / name)
      // to avoid wiping shared seed data used by other test suites.
      await prisma.orderAssignment.deleteMany({
        where: { factory: { productionType: "IntegrationType" } },
      });
      await prisma.dailyCapacity.deleteMany({
        where: { factory: { productionType: "IntegrationType" } },
      });
      await prisma.order.deleteMany({ where: { type: "IntegrationType" } });
      await prisma.factory.deleteMany({
        where: { productionType: "IntegrationType" },
      });
      await prisma.user.deleteMany({
        where: {
          username: {
            in: ["test-applicant-1", "test-applicant-2", "test-applicant-3"],
          },
        },
      });
    } catch {
      // Ignore if DB isn't running
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should successfully schedule an approved order, creating assignments and mutating capacity", async () => {
    try {
      // 1. Seed initial data
      const applicant = await prisma.user.create({
        data: {
          username: "test-applicant-1",
          email: "test-applicant-1@mail.shangjung.com",
          role: UserRole.SALES,
        },
      });

      const factoryA = await prisma.factory.create({
        data: {
          productionType: "IntegrationType",
          maxCapacity: 100,
          status: "ACTIVE",
        },
      });

      // Provide explicitly 50 initial capacity for tomorrow
      await prisma.dailyCapacity.create({
        data: {
          factoryId: factoryA.id,
          date: addDays(today, 1),
          maxCapacity: 100,
          curCapacity: 50,
        },
      });

      const order1 = await prisma.order.create({
        data: {
          name: "Test Order 1",
          type: "IntegrationType",
          applicantId: applicant.id,
          status: OrderStatus.PENDING,
          dueDate: addDays(today, 3), // window = tomorrow and day after
          quantity: 120,
        },
      });

      // 2. Execute runSchedule
      const dummyConfig: SchedulingConfig = {
        startDate: addDays(today, 1),
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GLOBAL_OPTIMIZE", // Changed from GAP_FILLING so it gets rescheduled
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };
      await runSchedule("IntegrationType", dummyConfig, today);

      // 3. Assert Database State
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order1.id },
        include: { assignments: true },
      });

      expect(updatedOrder?.status).toBe(OrderStatus.SCHEDULED);
      expect(updatedOrder?.assignments.length).toBeGreaterThan(0);

      const totalAssigned = updatedOrder!.assignments.reduce(
        (sum, a) => sum + a.assignedQuantity,
        0,
      );
      expect(totalAssigned).toBe(120);

      const capacities = await prisma.dailyCapacity.findMany({
        where: { factoryId: factoryA.id },
        orderBy: { date: "asc" },
      });

      // Should have 2 capacity records: Tomorrow (updated to 0), Day After Tomorrow (dynamically created, 100 - 70 = 30)
      expect(capacities.length).toBe(2);
      expect(capacities[0].curCapacity).toBe(0);
      expect(capacities[1].curCapacity).toBe(30);
    } catch (e: unknown) {
      if (isDatabaseUnreachable(e)) {
        console.warn("Skipping DB test because database is not reachable.");
      } else {
        throw e;
      }
    }
  });

  it("should re-allocate and delete old assignments when rescheduling a SCHEDULED order", async () => {
    try {
      const applicant = await prisma.user.create({
        data: {
          username: "test-applicant-2",
          email: "test-applicant-2@mail.shangjung.com",
          role: UserRole.SALES,
        },
      });

      const factoryA = await prisma.factory.create({
        data: {
          productionType: "IntegrationType",
          maxCapacity: 100,
          status: "ACTIVE",
        },
      });

      const order1 = await prisma.order.create({
        data: {
          name: "Reschedule Order",
          type: "IntegrationType",
          applicantId: applicant.id,
          status: OrderStatus.SCHEDULED,
          dueDate: addDays(today, 2),
          quantity: 60,
        },
      });

      // Mock an existing assignment that uses capacity
      const oldDate = addDays(today, 1);
      await prisma.dailyCapacity.create({
        data: {
          factoryId: factoryA.id,
          date: oldDate,
          maxCapacity: 100,
          curCapacity: 40, // 60 was used
        },
      });

      await prisma.orderAssignment.create({
        data: {
          orderId: order1.id,
          factoryId: factoryA.id,
          productionDate: oldDate,
          assignedQuantity: 60,
          status: AssignmentStatus.SCHEDULED,
        },
      });

      // 2. Execute
      const dummyConfig: SchedulingConfig = {
        startDate: addDays(today, 1),
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GLOBAL_OPTIMIZE",
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };
      await runSchedule("IntegrationType", dummyConfig, today);

      // 3. Assert DB State
      // The capacity should be reset to 100, then order scheduled again.
      // It will take 60 capacity, so curCapacity should be 40 again.
      // But the old assignment was deleted, and a new one was created.
      const updatedOrder = await prisma.order.findUnique({
        where: { id: order1.id },
        include: { assignments: true },
      });

      expect(updatedOrder?.status).toBe(OrderStatus.SCHEDULED);
      expect(updatedOrder?.assignments.length).toBe(1);
      expect(updatedOrder?.assignments[0].assignedQuantity).toBe(60);

      const capacities = await prisma.dailyCapacity.findMany({
        where: { factoryId: factoryA.id },
      });

      expect(capacities[0].curCapacity).toBe(40);
    } catch (e: unknown) {
      if (isDatabaseUnreachable(e)) {
        console.warn("Skipping DB test because database is not reachable.");
      } else {
        throw e;
      }
    }
  });

  it("should be idempotent across multiple identical runs", async () => {
    try {
      // 1. Seed initial data
      const applicant = await prisma.user.create({
        data: {
          username: "test-applicant-3",
          email: "test-applicant-3@mail.shangjung.com",
          role: UserRole.SALES,
        },
      });

      const factoryA = await prisma.factory.create({
        data: {
          productionType: "IntegrationType",
          maxCapacity: 100,
          status: "ACTIVE",
        },
      });

      const order1 = await prisma.order.create({
        data: {
          name: "Idempotent Order",
          type: "IntegrationType",
          applicantId: applicant.id,
          status: OrderStatus.PENDING,
          dueDate: addDays(today, 3), // window = tomorrow and day after
          quantity: 120,
        },
      });

      const dummyConfig: SchedulingConfig = {
        startDate: addDays(today, 1),
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        reschedulePolicy: "GLOBAL_OPTIMIZE",
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };

      // 2. Execute first run
      await runSchedule("IntegrationType", dummyConfig, today);

      // 3. Record state
      const assignmentsAfterFirstRun = await prisma.orderAssignment.findMany({
        where: { orderId: order1.id },
      });
      const capacitiesAfterFirstRun = await prisma.dailyCapacity.findMany({
        where: { factoryId: factoryA.id },
        orderBy: { date: "asc" },
      });

      // Assert basic correctness of first run
      expect(assignmentsAfterFirstRun.length).toBeGreaterThan(0);
      expect(capacitiesAfterFirstRun.length).toBeGreaterThan(0);

      // 4. Execute second run (exact same config and date)
      await runSchedule("IntegrationType", dummyConfig, today);

      // 5. Assert state is EXACTLY the same
      const assignmentsAfterSecondRun = await prisma.orderAssignment.findMany({
        where: { orderId: order1.id },
      });
      const capacitiesAfterSecondRun = await prisma.dailyCapacity.findMany({
        where: { factoryId: factoryA.id },
        orderBy: { date: "asc" },
      });

      expect(assignmentsAfterSecondRun.length).toBe(
        assignmentsAfterFirstRun.length,
      );
      expect(capacitiesAfterSecondRun.length).toBe(
        capacitiesAfterFirstRun.length,
      );

      for (let i = 0; i < capacitiesAfterFirstRun.length; i++) {
        expect(capacitiesAfterSecondRun[i].curCapacity).toBe(
          capacitiesAfterFirstRun[i].curCapacity,
        );
      }

      // Check total assigned quantity remains the same
      const totalAssignedFirst = assignmentsAfterFirstRun.reduce(
        (sum, a) => sum + a.assignedQuantity,
        0,
      );
      const totalAssignedSecond = assignmentsAfterSecondRun.reduce(
        (sum, a) => sum + a.assignedQuantity,
        0,
      );
      expect(totalAssignedSecond).toBe(totalAssignedFirst);
    } catch (e: unknown) {
      if (isDatabaseUnreachable(e)) {
        console.warn("Skipping DB test because database is not reachable.");
      } else {
        throw e;
      }
    }
  });
});
