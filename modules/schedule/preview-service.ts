import { prisma } from "@/lib/prisma";
import {
  simulateSchedule,
  fetchConflictOrders,
} from "@/modules/schedule/engine";
import type { SchedulingAlgorithmId } from "@/modules/schedule/algorithms";
import { findFactoriesForVisualization } from "@/infra/db/visualization-repository";
import { format } from "date-fns";
import type {
  ConflictInfo,
  DailyCapacityInfo,
  DiffEntry,
  FactoryInfo,
  TimelineItem,
} from "@/modules/visualization/types";

export type SchedulePreview = {
  algorithm: string;
  factories: FactoryInfo[];
  timeline: TimelineItem[];
  dailyCapacities: DailyCapacityInfo[];
  conflicts: ConflictInfo[];
  diffs: DiffEntry[];
  unscheduledOrders: {
    id: string;
    name: string;
    quantity: number;
    dueDate: string;
  }[];
};

function toDateStr(d: Date | string): string {
  return format(new Date(d), "yyyy-MM-dd");
}

export async function buildSchedulePreview(
  type: string,
  algorithmId: SchedulingAlgorithmId | string,
): Promise<SchedulePreview> {
  const { strategy, orders, capacitiesBefore, previousScheduled } =
    await simulateSchedule(type, algorithmId);

  const factoryRows = await findFactoriesForVisualization(prisma, {
    productionType: type,
  });
  const factories: FactoryInfo[] = factoryRows.map((f) => ({
    id: f.id,
    label: f.id.replace(/^factory-/, "Factory "),
    productionType: f.productionType,
    maxCapacity: f.maxCapacity,
  }));

  // Build orderId → {name, dueDate, quantity, applicantId} lookup from `orders`
  const orderMeta = new Map<
    string,
    { name: string; dueDate: string; quantity: number }
  >();
  const orderRows = await prisma.order.findMany({
    where: { id: { in: orders.map((o) => o.id) } },
    select: {
      id: true,
      name: true,
      dueDate: true,
      quantity: true,
      applicantId: true,
      lastModifiedById: true,
    },
  });
  const orderInfoById = new Map<
    string,
    {
      name: string;
      dueDate: string;
      quantity: number;
      applicantId: string;
      lastModifiedById: string | null;
    }
  >();
  for (const o of orderRows) {
    orderInfoById.set(o.id, {
      name: o.name,
      dueDate: toDateStr(o.dueDate),
      quantity: o.quantity,
      applicantId: o.applicantId,
      lastModifiedById: o.lastModifiedById,
    });
    orderMeta.set(o.id, {
      name: o.name,
      dueDate: toDateStr(o.dueDate),
      quantity: o.quantity,
    });
  }

  // -------------------------------------------------------------------------
  // Predicted timeline: surviving non-SCHEDULED assignments + simulated new
  // -------------------------------------------------------------------------
  const timeline: TimelineItem[] = [];

  // Surviving (IN_PRODUCTION / COMPLETED) assignments from orders
  for (const order of orders) {
    const info = orderInfoById.get(order.id);
    if (!info) continue;
    for (const a of order.assignments ?? []) {
      if (!a.factoryId || !a.productionDate) continue;
      timeline.push({
        assignmentId: `existing-${order.id}-${a.factoryId}-${toDateStr(a.productionDate)}`,
        orderId: order.id,
        orderName: info.name,
        factoryId: a.factoryId,
        productionDate: toDateStr(a.productionDate),
        assignedQuantity: a.assignedQuantity,
        status: a.status as TimelineItem["status"],
        dueDate: info.dueDate,
        applicantId: info.applicantId,
        lastModifiedById: info.lastModifiedById,
      });
    }
  }

  // New simulated SCHEDULED assignments
  for (const a of strategy.newAssignments) {
    const info = orderInfoById.get(a.orderId);
    if (!info) continue;
    timeline.push({
      assignmentId: `preview-${a.orderId}-${a.factoryId}-${toDateStr(a.productionDate)}`,
      orderId: a.orderId,
      orderName: info.name,
      factoryId: a.factoryId,
      productionDate: toDateStr(a.productionDate),
      assignedQuantity: a.assignedQuantity,
      status: "SCHEDULED",
      dueDate: info.dueDate,
      applicantId: info.applicantId,
      lastModifiedById: info.lastModifiedById,
    });
  }

  // -------------------------------------------------------------------------
  // Predicted daily capacities (post-simulation state)
  // -------------------------------------------------------------------------
  const capMap = new Map<
    string,
    { factoryId: string; date: string; max: number; cur: number }
  >();
  for (const c of capacitiesBefore) {
    const key = `${c.factoryId}__${toDateStr(c.date)}`;
    capMap.set(key, {
      factoryId: c.factoryId,
      date: toDateStr(c.date),
      max: c.maxCapacity,
      cur: c.curCapacity,
    });
  }
  for (const c of strategy.updatedCapacities) {
    const key = `${c.factoryId}__${toDateStr(c.date)}`;
    capMap.set(key, {
      factoryId: c.factoryId,
      date: toDateStr(c.date),
      max: c.maxCapacity,
      cur: c.curCapacity,
    });
  }
  for (const c of strategy.newCapacities) {
    const key = `${c.factoryId}__${toDateStr(c.date)}`;
    if (capMap.has(key)) continue;
    capMap.set(key, {
      factoryId: c.factoryId,
      date: toDateStr(c.date),
      max: c.maxCapacity,
      cur: c.curCapacity,
    });
  }

  // After simulation: capMap holds the projected state. But capacitiesBefore was a
  // pre-strategy snapshot of the DB (where SCHEDULED assignments were not yet
  // refunded). The strategy mutates capacities directly, so we must re-derive
  // used capacity from the predicted timeline instead.
  const usedByCell = new Map<string, number>();
  for (const t of timeline) {
    const key = `${t.factoryId}__${t.productionDate}`;
    usedByCell.set(key, (usedByCell.get(key) ?? 0) + t.assignedQuantity);
  }

  const dailyCapacities: DailyCapacityInfo[] = [];
  const dailyCapKeys = new Set<string>([
    ...capMap.keys(),
    ...usedByCell.keys(),
  ]);
  const factoryMaxById = new Map(factories.map((f) => [f.id, f.maxCapacity]));
  for (const key of dailyCapKeys) {
    const cap = capMap.get(key);
    const [factoryId, date] = key.split("__");
    const max = cap?.max ?? factoryMaxById.get(factoryId) ?? 0;
    const used = usedByCell.get(key) ?? 0;
    dailyCapacities.push({
      factoryId,
      date,
      maxCapacity: max,
      usedCapacity: used,
    });
  }

  // -------------------------------------------------------------------------
  // Conflicts (capacity + due date) — re-detect on predicted state
  // -------------------------------------------------------------------------
  const conflicts: ConflictInfo[] = [];
  for (const dc of dailyCapacities) {
    if (dc.usedCapacity > dc.maxCapacity) {
      const affected = timeline
        .filter(
          (t) => t.factoryId === dc.factoryId && t.productionDate === dc.date,
        )
        .map((t) => t.orderId);
      conflicts.push({
        conflictType: "CAPACITY",
        severity: "ERROR",
        factoryId: dc.factoryId,
        date: dc.date,
        orderIds: affected,
        message: `Total ${dc.usedCapacity.toLocaleString()} exceeds max capacity ${dc.maxCapacity.toLocaleString()}`,
      });
    }
  }
  for (const t of timeline) {
    if (t.productionDate > t.dueDate) {
      conflicts.push({
        conflictType: "DUE_DATE",
        severity: "ERROR",
        factoryId: t.factoryId,
        date: t.productionDate,
        orderIds: [t.orderId],
        message: `${t.orderName} production date ${t.productionDate} is after due date ${t.dueDate}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Diffs: per-order productionDate before → after
  // -------------------------------------------------------------------------
  const diffs: DiffEntry[] = [];
  const prevByOrder = new Map<string, string[]>();
  for (const p of previousScheduled) {
    const key = toDateStr(p.productionDate);
    const list = prevByOrder.get(p.orderId) ?? [];
    list.push(key);
    prevByOrder.set(p.orderId, list);
  }
  const newByOrder = new Map<string, string[]>();
  for (const a of strategy.newAssignments) {
    const key = toDateStr(a.productionDate);
    const list = newByOrder.get(a.orderId) ?? [];
    list.push(key);
    newByOrder.set(a.orderId, list);
  }
  const allDiffOrderIds = new Set([
    ...prevByOrder.keys(),
    ...newByOrder.keys(),
  ]);
  for (const orderId of allDiffOrderIds) {
    const info = orderInfoById.get(orderId);
    if (!info) continue;
    const before = (prevByOrder.get(orderId) ?? []).sort().join(", ") || "—";
    const after = (newByOrder.get(orderId) ?? []).sort().join(", ") || "—";
    if (before === after) continue;
    diffs.push({
      orderId,
      orderName: info.name,
      field: "productionDate",
      before,
      after,
      reason: `Algorithm: ${algorithmId}`,
    });
  }

  // -------------------------------------------------------------------------
  // Unscheduled / conflict orders
  // -------------------------------------------------------------------------
  const unscheduledOrders = await fetchConflictOrders(
    prisma,
    strategy.conflictOrderIds,
  );

  return {
    algorithm: String(algorithmId),
    factories,
    timeline,
    dailyCapacities,
    conflicts,
    diffs,
    unscheduledOrders,
  };
}
