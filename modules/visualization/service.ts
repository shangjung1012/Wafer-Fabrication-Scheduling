import type { PrismaClient } from "@/lib/generated/prisma";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole } from "@/modules/auth/rbac";
import { resolveActorScope, getScopeGroup } from "@/modules/auth/scope";
import {
  findFactoriesForVisualization,
  findAssignmentsForVisualization,
  findDailyCapacitiesForVisualization,
} from "@/infra/db/visualization-repository";
import type {
  TimelineResponse,
  FactoryInfo,
  TimelineItem,
  ConflictInfo,
  DailyCapacityInfo,
} from "./types";

export type TimelineFilters = {
  factoryId?: string;
  startDate?: string;
  endDate?: string;
};

export async function getTimeline(
  ctx: RequestContext,
  db: PrismaClient,
  filters: TimelineFilters
): Promise<TimelineResponse> {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);

  // Both ADMIN and SUPERADMIN see all factories in their production type
  const scopedFilters = { ...filters, productionType: getScopeGroup(scope) };

  const [factoryRows, assignmentRows, capacityRows] = await Promise.all([
    findFactoriesForVisualization(db, scopedFilters),
    findAssignmentsForVisualization(db, scopedFilters),
    findDailyCapacitiesForVisualization(db, scopedFilters),
  ]);

  const factories: FactoryInfo[] = factoryRows.map((f) => ({
    id: f.id,
    label: formatFactoryLabel(f.id),
    productionType: f.productionType,
    maxCapacity: f.maxCapacity,
  }));

  const timeline: TimelineItem[] = assignmentRows.map((a) => ({
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

  const dailyCapacities: DailyCapacityInfo[] = capacityRows.map((c) => ({
    factoryId: c.factoryId,
    date: c.date,
    maxCapacity: c.maxCapacity,
    usedCapacity: c.maxCapacity - c.curCapacity,
  }));

  const conflicts = detectConflicts(timeline, capacityRows);

  return { factories, timeline, conflicts, dailyCapacities, diffs: [] };
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

function detectConflicts(
  timeline: TimelineItem[],
  capacities: Array<{ factoryId: string; date: string; maxCapacity: number; curCapacity: number }>
): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];

  // Capacity conflicts: curCapacity < 0 means usedCapacity > maxCapacity
  for (const cap of capacities) {
    if (cap.curCapacity < 0) {
      const affectedOrders = timeline
        .filter((t) => t.factoryId === cap.factoryId && t.productionDate === cap.date)
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
