import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runSchedule } from "@/modules/schedule/engine";
import {
  OrderStatus,
  AssignmentStatus,
  UserRole,
} from "@/lib/generated/prisma/client";

// This file contains database integration tests.
// A real PostgreSQL database must be running and accessible via process.env.DATABASE_URL.

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
      await prisma.orderAssignment.deleteMany({ where: { factory: { productionType: "IntegrationType" } } });
      await prisma.dailyCapacity.deleteMany({   where: { factory: { productionType: "IntegrationType" } } });
      await prisma.order.deleteMany({           where: { type: "IntegrationType" } });
      await prisma.factory.deleteMany({         where: { productionType: "IntegrationType" } });
      await prisma.user.deleteMany({
        where: { accountId: { in: ["test-applicant-1", "test-applicant-2"] } },
      });
    } catch (e) {
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
          accountId: "test-applicant-1",
          name: "Test Applicant",
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
          status: OrderStatus.APPROVED,
          dueDate: addDays(today, 3), // window = tomorrow and day after
          quantity: 120,
        },
      });

      // 2. Execute runSchedule
      await runSchedule("IntegrationType");

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
    } catch (e: any) {
      if (e.message && e.message.includes("Can't reach database server")) {
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
          accountId: "test-applicant-2",
          name: "Test Applicant",
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
      await runSchedule("IntegrationType");

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
    } catch (e: any) {
      if (e.message && e.message.includes("Can't reach database server")) {
        console.warn("Skipping DB test because database is not reachable.");
      } else {
        throw e;
      }
    }
  });
});
