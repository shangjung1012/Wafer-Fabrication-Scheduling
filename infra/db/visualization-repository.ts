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
  factoryIds?: string[]; // takes precedence over factoryId; used for SALES scope
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  productionType?: string; // scope-enforced by service layer
};

export type SalesAssignmentRow = {
  orderId: string;
  factoryId: string;
};

export type PendingOrderRow = {
  id: string;
  name: string;
  status: string;
  quantity: number;
  dueDate: string; // YYYY-MM-DD
  createdAt: string; // YYYY-MM-DD
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
      ...(filters.factoryIds
        ? { id: { in: filters.factoryIds } }
        : filters.factoryId
          ? { id: filters.factoryId }
          : {}),
      ...(filters.productionType && !filters.factoryIds
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
      ...(filters.factoryIds
        ? { factoryId: { in: filters.factoryIds } }
        : filters.factoryId
          ? { factoryId: filters.factoryId }
          : {}),
      ...(filters.productionType && !filters.factoryIds
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
      ...(filters.factoryIds
        ? { factoryId: { in: filters.factoryIds } }
        : filters.factoryId
          ? { factoryId: filters.factoryId }
          : {}),
      ...(filters.productionType && !filters.factoryIds
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

export async function findSalesAssignments(
  db: PrismaClient,
  applicantId: string,
  filters: Pick<VisualizationFilters, "startDate" | "endDate">,
): Promise<SalesAssignmentRow[]> {
  const dateWhere = buildDateWhere(filters.startDate, filters.endDate);

  return db.orderAssignment.findMany({
    where: {
      order: { applicantId },
      ...(dateWhere ? { productionDate: dateWhere } : {}),
    },
    select: { orderId: true, factoryId: true },
  });
}

export async function findPendingOrdersForSales(
  db: PrismaClient,
  applicantId: string,
): Promise<PendingOrderRow[]> {
  const rows = await db.order.findMany({
    where: {
      applicantId,
      status: { in: ["PENDING", "FAILED", "CONFLICT"] },
    },
    select: {
      id: true,
      name: true,
      status: true,
      quantity: true,
      dueDate: true,
      createdAt: true,
    },
    orderBy: { dueDate: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    quantity: r.quantity,
    dueDate: format(r.dueDate, "yyyy-MM-dd"),
    createdAt: format(r.createdAt, "yyyy-MM-dd"),
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
