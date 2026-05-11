import type { PrismaClient } from "@/lib/generated/prisma";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export type FactoryRow = {
  id: string;
  productionType: string;
  maxCapacity: number;
};

export type AssignmentWithOrderRow = {
  id: string;
  orderId: string;
  factoryId: string;
  productionDate: string; // YYYY-MM-DD
  assignedQuantity: number;
  status: string;
  orderName: string;
  orderDueDate: string; // YYYY-MM-DD
  applicantId: string;
  lastModifiedById: string | null;
};

export type DailyCapacityRow = {
  factoryId: string;
  date: string; // YYYY-MM-DD
  maxCapacity: number;
  curCapacity: number;
};

export type VisualizationFilters = {
  factoryId?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  productionType?: string; // scope-enforced by service layer
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function findFactoriesForVisualization(
  db: PrismaClient,
  filters: VisualizationFilters,
): Promise<FactoryRow[]> {
  return db.factory.findMany({
    where: {
      status: "ACTIVE",
      ...(filters.factoryId ? { id: filters.factoryId } : {}),
      ...(filters.productionType
        ? { productionType: filters.productionType }
        : {}),
    },
    select: { id: true, productionType: true, maxCapacity: true },
    orderBy: [{ productionType: "asc" }, { id: "asc" }],
  });
}

export async function findAssignmentsForVisualization(
  db: PrismaClient,
  filters: VisualizationFilters,
): Promise<AssignmentWithOrderRow[]> {
  const dateWhere = buildDateWhere(filters.startDate, filters.endDate);

  const rows = await db.orderAssignment.findMany({
    where: {
      ...(filters.factoryId ? { factoryId: filters.factoryId } : {}),
      ...(filters.productionType
        ? { factory: { productionType: filters.productionType } }
        : {}),
      ...(dateWhere ? { productionDate: dateWhere } : {}),
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
          applicantId: true,
          lastModifiedById: true,
        },
      },
    },
    orderBy: { productionDate: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    factoryId: r.factoryId,
    productionDate: format(r.productionDate, "yyyy-MM-dd"),
    assignedQuantity: r.assignedQuantity,
    status: r.status,
    orderName: r.order.name,
    orderDueDate: format(r.order.dueDate, "yyyy-MM-dd"),
    applicantId: r.order.applicantId,
    lastModifiedById: r.order.lastModifiedById,
  }));
}

export async function findDailyCapacitiesForVisualization(
  db: PrismaClient,
  filters: VisualizationFilters,
): Promise<DailyCapacityRow[]> {
  const dateWhere = buildDateWhere(filters.startDate, filters.endDate);

  const rows = await db.dailyCapacity.findMany({
    where: {
      ...(filters.factoryId ? { factoryId: filters.factoryId } : {}),
      ...(filters.productionType
        ? { factory: { productionType: filters.productionType } }
        : {}),
      ...(dateWhere ? { date: dateWhere } : {}),
    },
    select: {
      factoryId: true,
      date: true,
      maxCapacity: true,
      curCapacity: true,
    },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    factoryId: r.factoryId,
    date: format(r.date, "yyyy-MM-dd"),
    maxCapacity: r.maxCapacity,
    curCapacity: r.curCapacity,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDateWhere(startDate?: string, endDate?: string) {
  if (!startDate && !endDate) return null;
  return {
    ...(startDate ? { gte: new Date(`${startDate}T00:00:00.000Z`) } : {}),
    ...(endDate ? { lte: new Date(`${endDate}T23:59:59.999Z`) } : {}),
  };
}
