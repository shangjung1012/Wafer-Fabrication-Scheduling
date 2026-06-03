import { describe, expect, it, vi } from "vitest";

import {
  findAssignmentsForVisualization,
  findDailyCapacitiesForVisualization,
  findFactoriesForVisualization,
  findPendingOrdersForAdmin,
  findPendingOrdersForSales,
  findSalesAssignments,
} from "@/infra/db/visualization-repository";
import type { PrismaClient } from "@/lib/generated/prisma";

function makeDb(overrides: Partial<PrismaClient>) {
  return overrides as PrismaClient;
}

describe("visualization-repository", () => {
  it("queries active factories with factoryIds taking precedence over type filters", async () => {
    const db = makeDb({
      factory: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "f-1", productionType: "A", maxCapacity: 120 },
          ]),
      },
    });

    const result = await findFactoriesForVisualization(db, {
      factoryId: "ignored",
      factoryIds: ["f-1", "f-2"],
      productionType: "A",
      productionTypes: ["A", "B"],
    });

    expect(result).toEqual([
      { id: "f-1", productionType: "A", maxCapacity: 120 },
    ]);
    expect(db.factory.findMany).toHaveBeenCalledWith({
      where: {
        status: "ACTIVE",
        id: { in: ["f-1", "f-2"] },
      },
      select: { id: true, productionType: true, maxCapacity: true },
      orderBy: [{ productionType: "asc" }, { id: "asc" }],
    });
  });

  it("queries factories by one production type when no factory scope is provided", async () => {
    const db = makeDb({
      factory: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    await findFactoriesForVisualization(db, { productionType: "B" });

    expect(db.factory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "ACTIVE", productionType: "B" },
      }),
    );
  });

  it("maps visualization assignments and applies local-day date bounds", async () => {
    const db = makeDb({
      orderAssignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "a-1",
            orderId: "o-1",
            factoryId: "f-1",
            productionDate: new Date(2026, 5, 3),
            assignedQuantity: 75,
            status: "SCHEDULED",
            order: {
              name: "Order Alpha",
              dueDate: new Date(2026, 5, 10),
              isFixed: true,
              isPrioritized: false,
              applicantId: "sales-1",
              lastModifiedById: "admin-1",
              applicant: { username: "sales" },
            },
          },
        ]),
      },
    });

    const result = await findAssignmentsForVisualization(db, {
      productionTypes: ["A", "B"],
      startDate: "2026-06-01",
      endDate: "2026-06-05",
    });

    expect(result).toEqual([
      {
        id: "a-1",
        orderId: "o-1",
        factoryId: "f-1",
        productionDate: "2026-06-03",
        assignedQuantity: 75,
        status: "SCHEDULED",
        orderName: "Order Alpha",
        orderDueDate: "2026-06-10",
        orderIsFixed: true,
        orderIsPrioritized: false,
        applicantId: "sales-1",
        applicantUsername: "sales",
        lastModifiedById: "admin-1",
      },
    ]);
    expect(db.orderAssignment.findMany).toHaveBeenCalledWith({
      where: {
        factory: { productionType: { in: ["A", "B"] } },
        productionDate: {
          gte: new Date(2026, 5, 1, 0, 0, 0, 0),
          lte: new Date(2026, 5, 5, 23, 59, 59, 999),
        },
      },
      select: {
        id: true,
        orderId: true,
        factoryId: true,
        productionDate: true,
        assignedQuantity: true,
        status: true,
        order: {
          select: {
            name: true,
            dueDate: true,
            isFixed: true,
            isPrioritized: true,
            applicantId: true,
            lastModifiedById: true,
            applicant: { select: { username: true } },
          },
        },
      },
      orderBy: { productionDate: "asc" },
    });
  });

  it("maps daily capacities with factoryId and end-date filters", async () => {
    const db = makeDb({
      dailyCapacity: {
        findMany: vi.fn().mockResolvedValue([
          {
            factoryId: "f-1",
            date: new Date(2026, 5, 4),
            maxCapacity: 100,
            curCapacity: 35,
          },
        ]),
      },
    });

    const result = await findDailyCapacitiesForVisualization(db, {
      factoryId: "f-1",
      endDate: "2026-06-04",
    });

    expect(result).toEqual([
      {
        factoryId: "f-1",
        date: "2026-06-04",
        maxCapacity: 100,
        curCapacity: 35,
      },
    ]);
    expect(db.dailyCapacity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          factoryId: "f-1",
          date: { lte: new Date(2026, 5, 4, 23, 59, 59, 999) },
        },
      }),
    );
  });

  it("finds sales assignments for an applicant in a start-date range", async () => {
    const db = makeDb({
      orderAssignment: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ orderId: "o-1", factoryId: "f-1" }]),
      },
    });

    const result = await findSalesAssignments(db, "sales-1", {
      startDate: "2026-06-02",
    });

    expect(result).toEqual([{ orderId: "o-1", factoryId: "f-1" }]);
    expect(db.orderAssignment.findMany).toHaveBeenCalledWith({
      where: {
        order: { applicantId: "sales-1" },
        productionDate: { gte: new Date(2026, 5, 2, 0, 0, 0, 0) },
      },
      select: { orderId: true, factoryId: true },
    });
  });

  it("maps pending sales orders into date-only rows", async () => {
    const db = makeDb({
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "o-1",
            name: "Pending Alpha",
            type: "A",
            status: "PENDING",
            quantity: 50,
            dueDate: new Date(2026, 5, 8),
            createdAt: new Date(2026, 4, 30),
            isFixed: false,
            isPrioritized: true,
          },
        ]),
      },
    });

    const result = await findPendingOrdersForSales(db, "sales-1");

    expect(result).toEqual([
      {
        id: "o-1",
        name: "Pending Alpha",
        type: "A",
        status: "PENDING",
        quantity: 50,
        dueDate: "2026-06-08",
        createdAt: "2026-05-30",
        isFixed: false,
        isPrioritized: true,
      },
    ]);
    expect(db.order.findMany).toHaveBeenCalledWith({
      where: { applicantId: "sales-1", status: "PENDING" },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        quantity: true,
        dueDate: true,
        createdAt: true,
        isFixed: true,
        isPrioritized: true,
      },
      orderBy: { dueDate: "asc" },
    });
  });

  it("scopes pending admin orders by type list when no single type is supplied", async () => {
    const db = makeDb({
      order: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "o-2",
            name: "Pending Beta",
            type: "B",
            status: "PENDING",
            quantity: 80,
            dueDate: new Date(2026, 6, 1),
            createdAt: new Date(2026, 5, 1),
            isFixed: true,
            isPrioritized: false,
          },
        ]),
      },
    });

    const result = await findPendingOrdersForAdmin(db, undefined, ["A", "B"]);

    expect(result[0]).toMatchObject({
      id: "o-2",
      type: "B",
      dueDate: "2026-07-01",
      createdAt: "2026-06-01",
      isFixed: true,
      isPrioritized: false,
    });
    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PENDING", type: { in: ["A", "B"] } },
        orderBy: [{ type: "asc" }, { dueDate: "asc" }],
      }),
    );
  });
});
