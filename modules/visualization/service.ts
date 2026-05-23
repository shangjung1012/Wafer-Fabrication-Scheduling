import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole } from "@/modules/auth/rbac";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
import type { SalesScope } from "@/modules/auth/scope";
import { getTime } from "@/lib/get-time";
import {
  findFactoriesForVisualization,
  findAssignmentsForVisualization,
  findDailyCapacitiesForVisualization,
  findSalesAssignments,
  findPendingOrdersForSales,
  findPendingOrdersForAdmin,
} from "@/infra/db/visualization-repository";
import { differenceInDays, parseISO, format } from "date-fns";
import type {
  TimelineResponse,
  FactoryInfo,
  TimelineItem,
  ConflictInfo,
  DailyCapacityInfo,
  PendingOrderInfo,
  OrderRisk,
} from "./types";

export type TimelineFilters = {
  factoryId?: string;
  startDate?: string;
  endDate?: string;
};

export async function getTimeline(
  ctx: RequestContext,
  db: PrismaClient,
  filters: TimelineFilters,
): Promise<TimelineResponse> {
  const scope = await resolveActorScope(ctx, db);

  if (scope.role === "SALES") {
    return getSalesTimeline(scope, db, filters);
  }

  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);

  // Both ADMIN and SUPERADMIN see all factories in their production type
  const productionType = getScopeGroup(scope);
  const scopedFilters = { ...filters, productionType };

  const [factoryRows, assignmentRows, capacityRows, pendingRows] =
    await Promise.all([
      findFactoriesForVisualization(db, scopedFilters),
      findAssignmentsForVisualization(db, scopedFilters),
      findDailyCapacitiesForVisualization(db, scopedFilters),
      findPendingOrdersForAdmin(db, productionType),
    ]);

  const factories = mapFactories(factoryRows);
  const timeline = mapTimeline(assignmentRows);
  const dailyCapacities = mapCapacities(capacityRows);
  const conflicts = detectConflicts(timeline, capacityRows);
  const today = format(await getTime(), "yyyy-MM-dd");

  const pendingOrders: PendingOrderInfo[] = pendingRows.map((r) => ({
    id: r.id,
    name: r.name,
    status: "PENDING",
    quantity: r.quantity,
    dueDate: r.dueDate,
    createdAt: r.createdAt,
    risk: calcRisk(r.dueDate, today),
  }));

  return {
    factories,
    timeline,
    conflicts,
    dailyCapacities,
    diffs: [],
    today,
    adminContext: { pendingOrders },
  };
}

// ---------------------------------------------------------------------------
// SALES path
// ---------------------------------------------------------------------------

async function getSalesTimeline(
  scope: SalesScope,
  db: PrismaClient,
  filters: TimelineFilters,
): Promise<TimelineResponse> {
  const salesRows = await findSalesAssignments(db, scope.userId, filters);
  const factoryIds = [...new Set(salesRows.map((r) => r.factoryId))];
  const myOrderIds = [...new Set(salesRows.map((r) => r.orderId))];

  const pendingRows = await findPendingOrdersForSales(db, scope.userId);
  const today = format(await getTime(), "yyyy-MM-dd");

  const pendingOrders: PendingOrderInfo[] = pendingRows.map((r) => ({
    id: r.id,
    name: r.name,
    status: "PENDING",
    quantity: r.quantity,
    dueDate: r.dueDate,
    createdAt: r.createdAt,
    risk: calcRisk(r.dueDate, today),
  }));

  if (factoryIds.length === 0) {
    return {
      factories: [],
      timeline: [],
      conflicts: [],
      dailyCapacities: [],
      diffs: [],
      today,
      salesContext: { myOrderIds: [], pendingOrders },
    };
  }

  const scopedFilters = { ...filters, factoryIds };
  const [factoryRows, assignmentRows, capacityRows] = await Promise.all([
    findFactoriesForVisualization(db, scopedFilters),
    findAssignmentsForVisualization(db, scopedFilters),
    findDailyCapacitiesForVisualization(db, scopedFilters),
  ]);

  const factories = mapFactories(factoryRows);
  const timeline = mapTimeline(assignmentRows);
  const dailyCapacities = mapCapacities(capacityRows);
  const conflicts = detectConflicts(timeline, capacityRows);

  return {
    factories,
    timeline,
    conflicts,
    dailyCapacities,
    diffs: [],
    today,
    salesContext: { myOrderIds, pendingOrders },
  };
}

function calcRisk(dueDate: string, today: string): OrderRisk {
  const diff = differenceInDays(parseISO(dueDate), parseISO(today));
  if (diff < 0) return "OVERDUE";
  if (diff <= 3) return "AT_RISK";
  return "ON_TRACK";
}

// ---------------------------------------------------------------------------
// Row mappers (shared between ADMIN and SALES paths)
// ---------------------------------------------------------------------------

function mapFactories(
  rows: Awaited<ReturnType<typeof findFactoriesForVisualization>>,
): FactoryInfo[] {
  return rows.map((f) => ({
    id: f.id,
    label: formatFactoryLabel(f.id),
    productionType: f.productionType,
    maxCapacity: f.maxCapacity,
  }));
}

function mapTimeline(
  rows: Awaited<ReturnType<typeof findAssignmentsForVisualization>>,
): TimelineItem[] {
  return rows.map((a) => ({
    assignmentId: a.id,
    orderId: a.orderId,
    orderName: a.orderName,
    factoryId: a.factoryId,
    productionDate: a.productionDate,
    assignedQuantity: a.assignedQuantity,
    status: a.status as TimelineItem["status"],
    dueDate: a.orderDueDate,
    applicantId: a.applicantId,
    lastModifiedById: a.lastModifiedById,
  }));
}

function mapCapacities(
  rows: Awaited<ReturnType<typeof findDailyCapacitiesForVisualization>>,
): DailyCapacityInfo[] {
  return rows.map((c) => ({
    factoryId: c.factoryId,
    date: c.date,
    maxCapacity: c.maxCapacity,
    usedCapacity: c.maxCapacity - c.curCapacity,
  }));
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

function detectConflicts(
  timeline: TimelineItem[],
  capacities: Array<{
    factoryId: string;
    date: string;
    maxCapacity: number;
    curCapacity: number;
  }>,
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];

  // Capacity conflicts: curCapacity < 0 means usedCapacity > maxCapacity
  for (const cap of capacities) {
    if (cap.curCapacity < 0) {
      const affectedOrders = timeline
        .filter(
          (t) => t.factoryId === cap.factoryId && t.productionDate === cap.date,
        )
        .map((t) => t.orderId);

      const used = cap.maxCapacity - cap.curCapacity;
      conflicts.push({
        conflictType: "CAPACITY",
        severity: "ERROR",
        factoryId: cap.factoryId,
        date: cap.date,
        orderIds: affectedOrders,
        message: `Total ${used.toLocaleString()} exceeds max capacity ${cap.maxCapacity.toLocaleString()}`,
      });
    }
  }

  // Due date conflicts: productionDate > order.dueDate
  for (const item of timeline) {
    if (item.productionDate > item.dueDate) {
      conflicts.push({
        conflictType: "DUE_DATE",
        severity: "ERROR",
        factoryId: item.factoryId,
        date: item.productionDate,
        orderIds: [item.orderId],
        message: `${item.orderName} production date ${item.productionDate} is after due date ${item.dueDate}`,
      });
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// "factory-A1" → "Factory A1"
function formatFactoryLabel(id: string): string {
  return id.replace(/^factory-/, "Factory ");
}
