"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  format,
  eachDayOfInterval,
  parseISO,
  differenceInDays,
} from "date-fns";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type {
  TimelineResponse,
  TimelineItem,
  ConflictInfo,
  DiffEntry,
  FactoryInfo,
  PendingOrderInfo,
  OrderRisk,
  SchedulePreviewResponse,
  DailyCapacityInfo,
} from "@/modules/visualization/types";
import { logoutClientAuthSession } from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import {
  DraggableAssignmentChip,
  DroppableCell,
} from "./_components/edit-cell";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function dateInputToIso(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

// ---------------------------------------------------------------------------
// Preview adapter
// ---------------------------------------------------------------------------

/**
 * Convert the new `/api/schedule/preview` payload (hydrated orders with their
 * assignments) into the SchedulePreviewResponse view-model the page already
 * renders. T4C/T4D will eventually consume the raw payload directly; until
 * then this adapter keeps the existing preview banner & timeline working.
 */
function convertNewScheduleToPreview(args: {
  newSchedule: Array<{
    id: string;
    status?: string;
    dueDate?: string | Date;
    name?: string;
    applicantId?: string;
    lastModifiedById?: string | null;
    assignments?: Array<{
      id?: string;
      orderId?: string;
      factoryId?: string;
      productionDate?: string | Date;
      assignedQuantity?: number;
      status?: string;
    }>;
  }>;
  affectedOrders: string[];
  failedOrderIds: string[];
  algorithm: string;
  baseTimeline: TimelineResponse | null;
}): SchedulePreviewResponse {
  const {
    newSchedule,
    affectedOrders,
    failedOrderIds,
    algorithm,
    baseTimeline,
  } = args;

  const affectedSet = new Set(affectedOrders);
  const failedSet = new Set(failedOrderIds);
  const orderById = new Map(newSchedule.map((o) => [o.id, o]));

  const toIsoDate = (d: string | Date | undefined): string => {
    if (!d) return "";
    if (d instanceof Date) return format(d, "yyyy-MM-dd");
    // Accept both ISO and already-yyyy-MM-dd strings.
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    try {
      return format(parseISO(d), "yyyy-MM-dd");
    } catch {
      return String(d).slice(0, 10);
    }
  };

  // Build TimelineItem[] from every assignment on every order in newSchedule.
  const timeline: TimelineItem[] = [];
  let synthAssignmentSeq = 0;
  for (const order of newSchedule) {
    for (const a of order.assignments ?? []) {
      if (!a.factoryId || !a.productionDate) continue;
      timeline.push({
        assignmentId: a.id ?? `preview-${order.id}-${synthAssignmentSeq++}`,
        orderId: a.orderId ?? order.id,
        orderName: order.name ?? order.id,
        factoryId: a.factoryId,
        productionDate: toIsoDate(a.productionDate),
        assignedQuantity: a.assignedQuantity ?? 0,
        status: (a.status as TimelineItem["status"]) ?? "SCHEDULED",
        dueDate: toIsoDate(order.dueDate),
        applicantId: order.applicantId ?? "",
        lastModifiedById: order.lastModifiedById ?? null,
      });
    }
  }

  // Factories: preview API doesn't return factories; reuse the baseline timeline's.
  const factories: FactoryInfo[] = baseTimeline?.factories ?? [];

  // Recompute dailyCapacities from new timeline + baseline maxCapacity map.
  const factoryMaxById = new Map(factories.map((f) => [f.id, f.maxCapacity]));
  const usedByCell = new Map<string, number>();
  for (const t of timeline) {
    const key = `${t.factoryId}__${t.productionDate}`;
    usedByCell.set(key, (usedByCell.get(key) ?? 0) + t.assignedQuantity);
  }
  const dailyCapMap = new Map<string, DailyCapacityInfo>();
  // Seed from baseline so untouched cells still show their maxCapacity row.
  for (const dc of baseTimeline?.dailyCapacities ?? []) {
    dailyCapMap.set(`${dc.factoryId}__${dc.date}`, {
      ...dc,
      usedCapacity: 0,
    });
  }
  for (const [key, used] of usedByCell.entries()) {
    const [factoryId, date] = key.split("__");
    const existing = dailyCapMap.get(key);
    if (existing) {
      existing.usedCapacity = used;
    } else {
      dailyCapMap.set(key, {
        factoryId,
        date,
        maxCapacity: factoryMaxById.get(factoryId) ?? 0,
        usedCapacity: used,
      });
    }
  }
  const dailyCapacities = Array.from(dailyCapMap.values());

  // Conflicts: capacity overflow + due-date violations.
  const conflicts: ConflictInfo[] = [];
  for (const dc of dailyCapacities) {
    if (dc.maxCapacity > 0 && dc.usedCapacity > dc.maxCapacity) {
      const orderIds = timeline
        .filter(
          (t) => t.factoryId === dc.factoryId && t.productionDate === dc.date,
        )
        .map((t) => t.orderId);
      conflicts.push({
        conflictType: "CAPACITY",
        severity: "ERROR",
        factoryId: dc.factoryId,
        date: dc.date,
        orderIds,
        message: `Total ${dc.usedCapacity.toLocaleString()} exceeds max capacity ${dc.maxCapacity.toLocaleString()}`,
      });
    }
  }
  for (const t of timeline) {
    if (t.dueDate && t.productionDate > t.dueDate) {
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

  // Diffs: produce a minimal entry per affected order, comparing earliest
  // baseline production date vs earliest new production date. Sufficient for
  // the preview banner count; T4D may refine.
  const baseFirstDateByOrder = new Map<string, string>();
  for (const t of baseTimeline?.timeline ?? []) {
    const prev = baseFirstDateByOrder.get(t.orderId);
    if (!prev || t.productionDate < prev) {
      baseFirstDateByOrder.set(t.orderId, t.productionDate);
    }
  }
  const newFirstDateByOrder = new Map<string, string>();
  for (const t of timeline) {
    const prev = newFirstDateByOrder.get(t.orderId);
    if (!prev || t.productionDate < prev) {
      newFirstDateByOrder.set(t.orderId, t.productionDate);
    }
  }
  const diffs: DiffEntry[] = [];
  for (const id of affectedSet) {
    const before = baseFirstDateByOrder.get(id) ?? "";
    const after = newFirstDateByOrder.get(id) ?? "";
    if (before === after) continue;
    const o = orderById.get(id);
    diffs.push({
      orderId: id,
      orderName: o?.name ?? id,
      field: "productionDate",
      before,
      after,
      reason: "rescheduled by preview",
    });
  }

  const unscheduledOrders = Array.from(failedSet).map((id) => {
    const o = orderById.get(id);
    return {
      id,
      name: o?.name ?? id,
      quantity: 0,
      dueDate: toIsoDate(o?.dueDate),
    };
  });

  return {
    algorithm,
    factories,
    timeline,
    dailyCapacities,
    conflicts,
    diffs,
    unscheduledOrders,
  };
}

// ---------------------------------------------------------------------------
// Cell computation
// ---------------------------------------------------------------------------

type CellData = {
  factoryId: string;
  date: string;
  items: TimelineItem[];
  usedCapacity: number;
  maxCapacity: number;
  conflicts: ConflictInfo[];
};

function buildCellMap(
  data: TimelineResponse,
  dates: string[],
): Map<string, CellData> {
  const map = new Map<string, CellData>();

  const capacityLookup = new Map<string, { used: number; max: number }>();
  for (const dc of data.dailyCapacities) {
    capacityLookup.set(`${dc.factoryId}__${dc.date}`, {
      used: dc.usedCapacity,
      max: dc.maxCapacity,
    });
  }

  const conflictLookup = new Map<string, ConflictInfo[]>();
  for (const c of data.conflicts) {
    const key = `${c.factoryId}__${c.date}`;
    const existing = conflictLookup.get(key) ?? [];
    conflictLookup.set(key, [...existing, c]);
  }

  for (const factory of data.factories) {
    for (const date of dates) {
      const key = `${factory.id}__${date}`;
      const items = data.timeline.filter(
        (t) => t.factoryId === factory.id && t.productionDate === date,
      );
      const cap = capacityLookup.get(key);
      map.set(key, {
        factoryId: factory.id,
        date,
        items,
        usedCapacity: cap?.used ?? 0,
        maxCapacity: cap?.max ?? factory.maxCapacity,
        conflicts: conflictLookup.get(key) ?? [],
      });
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Cell colours
// ---------------------------------------------------------------------------

function getCellStyle(cell: CellData): {
  bg: string;
  barColor: string;
  fillRatio: number;
} {
  if (cell.items.length === 0) {
    return { bg: "bg-gray-50", barColor: "bg-gray-200", fillRatio: 0 };
  }

  const ratio = cell.maxCapacity > 0 ? cell.usedCapacity / cell.maxCapacity : 0;
  const hasCapacityConflict = cell.conflicts.some(
    (c) => c.conflictType === "CAPACITY",
  );
  const hasDueDateConflict = cell.conflicts.some(
    (c) => c.conflictType === "DUE_DATE",
  );

  if (hasCapacityConflict) {
    return {
      bg: "bg-red-50",
      barColor: "bg-red-500",
      fillRatio: Math.min(ratio, 1),
    };
  }
  if (hasDueDateConflict) {
    return {
      bg: "bg-orange-50",
      barColor: "bg-orange-400",
      fillRatio: Math.min(ratio, 1),
    };
  }
  if (ratio > 0.8) {
    return { bg: "bg-yellow-50", barColor: "bg-yellow-400", fillRatio: ratio };
  }
  return { bg: "bg-blue-50", barColor: "bg-blue-400", fillRatio: ratio };
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-700",
  IN_PRODUCTION: "bg-green-100 text-green-700",
  COMPLETED: "bg-gray-100 text-gray-600",
  CANCELLED: "bg-red-100 text-red-600",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({
  cell,
  factory,
  diffByOrderId,
  myOrderIds,
  etaByOrderId,
  onEditOrder,
  onClose,
}: {
  cell: CellData;
  factory: FactoryInfo;
  diffByOrderId: Map<string, DiffEntry>;
  myOrderIds?: string[];
  etaByOrderId?: Map<string, string>;
  onEditOrder: (order: OrderEditorValues) => void;
  onClose: () => void;
}) {
  const myOrderIdSet = new Set(myOrderIds ?? []);
  const myOrderItems = cell.items.filter((i) => myOrderIdSet.has(i.orderId));
  const fillRatio =
    cell.maxCapacity > 0 ? cell.usedCapacity / cell.maxCapacity : 0;
  const isOverCapacity = fillRatio > 1;
  const pct = Math.round(fillRatio * 100);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-200 shadow-xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <p className="text-xs text-gray-500 font-medium">
            Type {factory.productionType}
          </p>
          <h2 className="text-base font-semibold text-gray-900">
            {factory.label}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{cell.date}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
        >
          ✕
        </button>
      </div>

      {/* Capacity summary */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">
            Capacity Usage
          </span>
          <span
            className={`text-sm font-semibold ${isOverCapacity ? "text-red-600" : "text-gray-700"}`}
          >
            {cell.usedCapacity.toLocaleString()} /{" "}
            {cell.maxCapacity.toLocaleString()}
            <span className="ml-1 text-xs font-normal">({pct}%)</span>
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isOverCapacity ? "bg-red-500" : pct > 80 ? "bg-yellow-400" : "bg-blue-400"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        {isOverCapacity && (
          <p className="text-xs text-red-600 mt-1 font-medium">
            Exceeds capacity by{" "}
            {(cell.usedCapacity - cell.maxCapacity).toLocaleString()} units
          </p>
        )}
      </div>

      {/* Conflicts */}
      {cell.conflicts.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Conflicts
          </p>
          {cell.conflicts.map((c, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-xs ${c.severity === "ERROR" ? "bg-red-50 text-red-700 border border-red-200" : "bg-orange-50 text-orange-700 border border-orange-200"}`}
            >
              <span className="font-semibold">[{c.conflictType}]</span>{" "}
              {c.message}
            </div>
          ))}
        </div>
      )}

      {/* Order list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Orders ({cell.items.length})
        </p>
        {cell.items.length === 0 && (
          <p className="text-sm text-gray-400">No assignments on this day.</p>
        )}
        {cell.items.map((item) => {
          const diff = diffByOrderId.get(item.orderId);
          return (
            <div
              key={item.orderId}
              className={`border rounded-lg p-3 transition-colors ${diff ? "border-purple-200 bg-purple-50/40 hover:border-purple-300" : "border-gray-100 hover:border-gray-200"}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-sm font-medium text-gray-900">
                  {item.orderName}
                </span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  {item.status === "SCHEDULED" && (
                    <button
                      type="button"
                      onClick={() =>
                        onEditOrder({
                          orderId: item.orderId,
                          name: item.orderName,
                          quantity: String(item.assignedQuantity),
                          status: item.status,
                          dueDate: item.dueDate,
                          type: factory.productionType,
                        })
                      }
                      className="rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 hover:text-gray-900"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-500 space-y-0.5">
                <div className="flex justify-between">
                  <span>Qty</span>
                  <span className="font-medium text-gray-700">
                    {item.assignedQuantity.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Due</span>
                  <span
                    className={`font-medium ${item.dueDate < item.productionDate ? "text-red-600" : "text-gray-700"}`}
                  >
                    {item.dueDate}
                    {item.dueDate < item.productionDate && " ⚠️"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Applicant</span>
                  <span className="font-medium text-blue-700 font-mono">
                    {item.applicantId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Scheduled by</span>
                  <span
                    className={`font-medium font-mono ${item.lastModifiedById ? "text-purple-700" : "text-gray-400"}`}
                  >
                    {item.lastModifiedById ?? "—"}
                  </span>
                </div>
              </div>
              {diff && (
                <div className="mt-2 pt-2 border-t border-purple-100">
                  <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide mb-1">
                    Rescheduled
                  </p>
                  <div className="text-xs text-purple-700 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 w-12">Before</span>
                      <span className="font-medium line-through text-gray-400">
                        {diff.before}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-400 w-12">After</span>
                      <span className="font-medium">{diff.after}</span>
                    </div>
                    <p className="text-[10px] text-purple-500 mt-1 leading-relaxed">
                      {diff.reason}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* My Orders section (SALES view) */}
      {myOrderItems.length > 0 && (
        <div className="px-5 py-4 border-t border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            My Orders
          </p>
          {myOrderItems.map((item) => {
            const hasConflict = cell.conflicts.some(
              (c) =>
                c.conflictType === "DUE_DATE" &&
                c.orderIds.includes(item.orderId),
            );
            const isOverdue = hasConflict || item.dueDate < item.productionDate;
            const eta = etaByOrderId?.get(item.orderId) ?? item.productionDate;
            return (
              <div
                key={item.orderId}
                className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">
                    {item.orderName}
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${isOverdue ? "text-red-500" : "text-green-600"}`}
                  >
                    {isOverdue ? "⚠ At-risk" : "● On-track"}
                  </span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>ETA</span>
                  <span
                    className={`font-medium ${isOverdue ? "text-red-600" : "text-gray-700"}`}
                  >
                    {eta}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending orders sidebar (SALES only)
// ---------------------------------------------------------------------------

function PendingSidebar({
  orders,
  today,
  onEditOrder,
  onCreate,
}: {
  orders: PendingOrderInfo[];
  today: string;
  onEditOrder: (order: OrderEditorValues) => void;
  onCreate?: () => void;
}) {
  const pending = orders.filter((o) => o.status === "PENDING");
  const approved = orders.filter((o) => o.status === "APPROVED");

  const riskDot = (risk: OrderRisk) => {
    if (risk === "OVERDUE")
      return <span className="text-red-500 text-[10px]">●</span>;
    if (risk === "AT_RISK")
      return <span className="text-orange-400 text-[10px]">●</span>;
    return <span className="text-green-500 text-[10px]">●</span>;
  };

  const borderColor = (risk: OrderRisk) => {
    if (risk === "OVERDUE") return "border-l-4 border-l-red-400";
    if (risk === "AT_RISK") return "border-l-4 border-l-orange-400";
    return "border-l-4 border-l-green-400";
  };

  const daysLabel = (dueDate: string) => {
    const diff = differenceInDays(parseISO(dueDate), parseISO(today));
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return "Due today";
    return `${diff}d left`;
  };

  const renderOrders = (list: PendingOrderInfo[]) =>
    list.map((o) => (
      <div
        key={o.id}
        className={`bg-white rounded-lg p-3 text-xs space-y-1 shadow-sm ${borderColor(o.risk)}`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="font-medium text-gray-900 leading-tight">
            {o.name}
          </span>
          {riskDot(o.risk)}
        </div>
        <div className="flex justify-between text-gray-500">
          <span>Qty</span>
          <span className="font-medium text-gray-700">
            {o.quantity.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between text-gray-500">
          <span>Due</span>
          <span
            className={`font-medium ${o.risk === "OVERDUE" ? "text-red-600" : o.risk === "AT_RISK" ? "text-orange-500" : "text-gray-700"}`}
          >
            {o.dueDate}
          </span>
        </div>
        <div
          className={`text-right text-[10px] font-semibold ${o.risk === "OVERDUE" ? "text-red-500" : o.risk === "AT_RISK" ? "text-orange-400" : "text-gray-400"}`}
        >
          {daysLabel(o.dueDate)}
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() =>
              onEditOrder({
                orderId: o.id,
                name: o.name,
                quantity: String(o.quantity),
                status: o.status,
                dueDate: o.dueDate,
              })
            }
            className="text-[10px] font-semibold px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Edit
          </button>
        </div>
      </div>
    ));

  return (
    <div className="flex-none w-64 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">
              My Pending Orders
            </p>
            <p className="text-[10px] text-gray-400">
              {orders.length} unscheduled
            </p>
          </div>
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <span className="text-sm leading-none">+</span>
              New Order
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {orders.length === 0 && (
          <p className="text-xs text-gray-400 text-center pt-4">
            No pending orders
          </p>
        )}
        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Awaiting Approval
            </p>
            {renderOrders(pending)}
          </div>
        )}
        {approved.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              Awaiting Schedule
            </p>
            {renderOrders(approved)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order form dialog
// ---------------------------------------------------------------------------

type OrderEditorValues = {
  name: string;
  quantity: string;
  type?: string;
  dueDate?: string;
  orderId?: string;
  status?: string;
};

function OrderFormModal({
  open,
  title,
  mode,
  initialValues,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  mode: "create" | "edit";
  initialValues: OrderEditorValues;
  onClose: () => void;
  onSubmit: (values: OrderEditorValues) => Promise<void>;
}) {
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(initialValues.quantity);
  const [type, setType] = useState(initialValues.type ?? "A");
  const [dueDate, setDueDate] = useState(initialValues.dueDate ?? "2026-12-31");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initialValues.name);
    setQuantity(initialValues.quantity);
    setType(initialValues.type ?? "A");
    setDueDate(initialValues.dueDate ?? "2026-12-31");
    setSubmitting(false);
    setError("");
  }, [open, initialValues]);

  if (!open) return null;

  const isCreate = mode === "create";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onSubmit({
        name: name.trim(),
        quantity: quantity.trim(),
        type: isCreate ? type.trim() : undefined,
        dueDate: isCreate ? dueDate : undefined,
        orderId: initialValues.orderId,
        status: initialValues.status,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 text-xs text-gray-500">
              {isCreate
                ? "Create a new sales order using the current production style."
                : "Update the order name or quantity and save the change."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {!isCreate && initialValues.orderId && (
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="font-semibold text-gray-400 uppercase tracking-wide">
                  Order ID
                </div>
                <div className="mt-1 font-mono text-gray-700">
                  {initialValues.orderId}
                </div>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="font-semibold text-gray-400 uppercase tracking-wide">
                  Status
                </div>
                <div className="mt-1 font-medium text-gray-700">
                  {initialValues.status ?? "—"}
                </div>
              </div>
            </div>
          )}

          <label className="block text-sm font-medium text-gray-700">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCreate ? "Order name" : "new name (optional)"}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          {isCreate && (
            <label className="block text-sm font-medium text-gray-700">
              Type (production group: A/B/C)
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              >
                {(["A", "B", "C"] as const).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isCreate && (
            <label className="block text-sm font-medium text-gray-700">
              Due Date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>
          )}

          <label className="block text-sm font-medium text-gray-700">
            Quantity
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={isCreate ? "Quantity" : "new quantity (optional)"}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving…" : mode === "create" ? "Send" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gantt cell
// ---------------------------------------------------------------------------

function GanttCell({
  cell,
  hasRescheduled,
  isMyOrder,
  isSales,
  editMode,
  movedAssignmentIds,
  onClick,
}: {
  cell: CellData;
  hasRescheduled: boolean;
  isMyOrder: boolean;
  isSales: boolean;
  editMode: boolean;
  movedAssignmentIds: Set<string>;
  onClick: () => void;
}) {
  const { bg, barColor, fillRatio } = getCellStyle(cell);
  const hasConflict = cell.conflicts.length > 0;
  const pct = Math.round(fillRatio * 100);
  const cellId = `${cell.factoryId}|${cell.date}`;

  // Edit-mode cell: shows draggable chips + drop target, no click handler.
  if (editMode) {
    return (
      <td className="border border-gray-100 w-[72px] min-w-[72px] p-0 align-top">
        <DroppableCell
          cellId={cellId}
          className={`w-full min-h-14 relative ${bg}`}
        >
          {hasConflict && (
            <span className="absolute top-0.5 right-0.5 text-[9px] leading-none z-10">
              ⚠️
            </span>
          )}
          <div className="flex flex-col gap-0.5 p-0.5">
            {cell.items.map((item) => (
              <DraggableAssignmentChip
                key={item.assignmentId}
                item={item}
                isMoved={movedAssignmentIds.has(item.assignmentId)}
              />
            ))}
          </div>
          {cell.items.length > 0 && (
            <div className="w-full px-1 pb-1">
              <div className="w-full h-1 bg-white/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <p
                className={`text-[9px] font-semibold text-center mt-0.5 ${pct > 100 ? "text-red-600" : "text-gray-500"}`}
              >
                {pct}%
              </p>
            </div>
          )}
        </DroppableCell>
      </td>
    );
  }

  if (cell.items.length === 0) {
    return (
      <td className="border border-gray-100 w-[72px] min-w-[72px] h-14 p-0">
        <div className="w-full h-full bg-gray-50" />
      </td>
    );
  }

  return (
    <td className="border border-gray-100 w-[72px] min-w-[72px] h-14 p-0">
      <button
        onClick={onClick}
        className={`w-full h-full flex flex-col items-center justify-end relative cursor-pointer hover:brightness-95 transition-all ${bg} group ${isSales && !isMyOrder ? "opacity-60" : ""} ${isMyOrder ? "ring-2 ring-inset ring-blue-500" : ""}`}
      >
        {/* Conflict marker */}
        {hasConflict && (
          <span className="absolute top-1 right-1 text-[9px] leading-none">
            ⚠️
          </span>
        )}

        {/* Rescheduled marker */}
        {hasRescheduled && !hasConflict && (
          <span className="absolute top-1 right-1 text-[9px] leading-none text-purple-500 font-bold">
            ↕
          </span>
        )}
        {hasRescheduled && hasConflict && (
          <span className="absolute top-1 right-4 text-[9px] leading-none text-purple-500 font-bold">
            ↕
          </span>
        )}

        {/* Order count badge */}
        {cell.items.length > 0 && (
          <span className="absolute top-1 left-1 text-[9px] font-bold text-gray-500">
            ×{cell.items.length}
          </span>
        )}

        {/* My order indicator (SALES view) */}
        {isMyOrder && (
          <span className="absolute top-1 left-5 text-[8px] leading-none text-blue-600">
            ●
          </span>
        )}

        {/* Capacity bar */}
        <div className="w-full px-1 pb-1">
          <div className="w-full h-1 bg-white/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <p
            className={`text-[9px] font-semibold text-center mt-0.5 ${pct > 100 ? "text-red-600" : "text-gray-500"}`}
          >
            {pct}%
          </p>
        </div>
      </button>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const DEFAULT_START = "2026-05-10";
const DEFAULT_END = "2026-05-23";

type FetchError = { status: number; message: string };
type ScheduleStatus = "idle" | "running" | "success" | "conflict" | "error";
type NotifyStatus = "idle" | "sending" | "sent" | "error";

type ConflictOrderInfo = {
  id: string;
  name: string;
  quantity: number;
  dueDate: string;
  applicantEmail: string | null;
  applicantUsername: string | null;
  adminEmail: string | null;
  adminUsername: string | null;
};

type AssignmentMove = {
  factoryId: string;
  productionDate: string;
  original: { factoryId: string; productionDate: string };
};
type OrderEditorState = OrderEditorValues & { orderId?: string };

export default function SchedulePage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const isSales = session?.user.role === "SALES";
  const productionType = session?.user.group ?? "";
  const [startDate, setStartDate] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState(DEFAULT_END);
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<FetchError | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    factoryId: string;
    date: string;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus>("idle");
  const [scheduleConflicts, setScheduleConflicts] = useState<
    ConflictOrderInfo[]
  >([]);
  const [emailsAutoSent, setEmailsAutoSent] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState<NotifyStatus>("idle");
  const [notifiedCount, setNotifiedCount] = useState<number>(0);

  // Reschedule policy selector + preview state
  const [reschedulePolicy, setReschedulePolicy] = useState<
    "GLOBAL_OPTIMIZE" | "PRIORITY_RETAIN" | "GAP_FILLING"
  >("GAP_FILLING");
  const [previewData, setPreviewData] =
    useState<SchedulePreviewResponse | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Edit-mode state
  const [editMode, setEditMode] = useState(false);
  // Map<assignmentId, AssignmentMove>
  const [pendingMoves, setPendingMoves] = useState<Map<string, AssignmentMove>>(
    () => new Map(),
  );
  const [draggingAssignment, setDraggingAssignment] =
    useState<TimelineItem | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Simulation mode state (from dev)
  const [simMode, setSimMode] = useState(false);
  const [simDate, setSimDate] = useState("");
  const [simLoading, setSimLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderEditorState | null>(null);

  // Fetch timeline data
  useEffect(() => {
    if (session === null) {
      router.replace("/login");
      return;
    }
    if (session === undefined) return;

    const params = new URLSearchParams({ startDate, endDate });
    fetch(`/api/visualization/timeline?${params}`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setFetchError({
            status: r.status,
            message: body.message ?? r.statusText,
          });
          setData(null);
        } else {
          setData(await r.json());
        }
        setLoading(false);
      })
      .catch(() => {
        setFetchError({ status: 0, message: "Network error" });
        setLoading(false);
      });
  }, [router, session, startDate, endDate, refreshKey]);

  // Run schedule handler (applies the selected algorithm directly)
  const handleRunSchedule = async (algorithmOverride?: string) => {
    if (!productionType) return;
    const algorithm = algorithmOverride ?? reschedulePolicy;
    setScheduleStatus("running");
    setScheduleConflicts([]);
    setEmailsAutoSent(false);
    setNotifyStatus("idle");
    try {
      const res = await fetch("/api/schedule/run", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: productionType, algorithm }),
      });
      if (res.status === 409) {
        setScheduleStatus("conflict");
      } else if (res.ok) {
        // Refactor: /api/schedule/run no longer returns conflicts/emailsSent.
        // Conflict banner is driven exclusively by preview (T4D); a successful
        // run clears any stale banner state.
        setScheduleStatus("success");
        setTimeout(() => setScheduleStatus("idle"), 4000);
        setLoading(true);
        setFetchError(null);
        setPreviewData(null);
        setPreviewId(null);
        setRefreshKey((k) => k + 1);
      } else {
        setScheduleStatus("error");
        setTimeout(() => setScheduleStatus("idle"), 4000);
      }
    } catch {
      setScheduleStatus("error");
      setTimeout(() => setScheduleStatus("idle"), 4000);
    }
  };

  const handlePreviewSchedule = async () => {
    if (!productionType) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/schedule/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: productionType,
          config: {
            reschedulePolicy,
            frozenDays: 0,
            productionDays: 1,
            bufferDays: 0,
            algorithm: "GREEDY_BEST_FIT",
            splittable: true,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPreviewError(body.message ?? `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      const { previewId: nextPreviewId, data: previewBody } = json ?? {};
      const {
        newSchedule = [],
        affectedOrders = [],
        failedOrderIds = [],
        conflictOrderIds = [],
        conflictOrders = [],
        conflictWarnings = [],
      } = previewBody ?? {};

      // Adapter: convert hydrated newSchedule -> SchedulePreviewResponse view model.
      const preview = convertNewScheduleToPreview({
        newSchedule,
        affectedOrders,
        failedOrderIds,
        algorithm: reschedulePolicy,
        baseTimeline: data,
      });

      setPreviewId(nextPreviewId ?? null);
      setPreviewData(preview);
      // T4D: conflict banner is driven by preview. Hydrated conflictOrders
      // (with applicant + admin email) feed scheduleConflicts; Notify button
      // POSTs them to /api/schedule/notify. Reset notify state so the amber
      // (action-required) banner shows on each fresh preview.
      if (Array.isArray(conflictOrders) && conflictOrders.length > 0) {
        setScheduleConflicts(conflictOrders as ConflictOrderInfo[]);
        setNotifyStatus("idle");
        setEmailsAutoSent(false);
      } else {
        setScheduleConflicts([]);
      }
      // conflictOrderIds / conflictWarnings are intentionally unused here:
      // the hydrated conflictOrders payload already covers the banner.
      void conflictOrderIds;
      void conflictWarnings;
    } catch {
      setPreviewError("Network error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyPreview = async () => {
    if (!previewId) {
      setPreviewError("沒有可套用的 preview，請先按 Preview");
      return;
    }
    setApplying(true);
    setPreviewError(null);
    try {
      const res = await fetch("/api/schedule/apply", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId }),
      });

      if (res.status === 409) {
        // OCC failure or concurrent lock — discard preview and surface error.
        const body = await res.json().catch(() => ({}));
        setPreviewError(body?.message ?? "資料已變更，請重新預覽");
        setPreviewData(null);
        setPreviewId(null);
        return;
      }

      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        setPreviewError(body?.message ?? "Preview 已過期，請重新預覽");
        setPreviewData(null);
        setPreviewId(null);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPreviewError(body?.message ?? "套用失敗");
        setScheduleStatus("error");
        setTimeout(() => setScheduleStatus("idle"), 4000);
        return;
      }

      // Success — clear preview state and refetch timeline.
      setPreviewData(null);
      setPreviewId(null);
      setScheduleStatus("success");
      setTimeout(() => setScheduleStatus("idle"), 4000);
      setLoading(true);
      setFetchError(null);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error(e);
      setPreviewError("Network error");
      setScheduleStatus("error");
      setTimeout(() => setScheduleStatus("idle"), 4000);
    } finally {
      setApplying(false);
    }
  };

  const handleDiscardPreview = () => {
    setPreviewData(null);
    setPreviewId(null);
    setPreviewError(null);
  };

  // Edit-mode handlers
  const handleEnterEditMode = () => {
    setEditMode(true);
    setPendingMoves(new Map());
    setSaveStatus("idle");
    setSelectedCell(null);
    setPreviewData(null);
    setPreviewId(null);
  };

  const handleDiscardEdits = () => {
    setEditMode(false);
    setPendingMoves(new Map());
    setSaveStatus("idle");
  };

  const handleSaveEdits = async () => {
    if (pendingMoves.size === 0) {
      setEditMode(false);
      return;
    }
    setSaveStatus("saving");
    setSaveErrorMsg(null);
    try {
      const moves = Array.from(pendingMoves.entries()).map(([id, m]) => ({
        assignmentId: id,
        factoryId: m.factoryId,
        productionDate: m.productionDate,
      }));
      const res = await fetch("/api/assignments/bulk", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveStatus("error");
        setSaveErrorMsg(body.message ?? `HTTP ${res.status}`);
        setTimeout(() => setSaveStatus("idle"), 6000);
        return;
      }
      const applied = typeof body.applied === "number" ? body.applied : 0;
      const errors: { assignmentId: string; reason: string }[] = Array.isArray(
        body.errors,
      )
        ? body.errors
        : [];
      if (applied === 0 && errors.length > 0) {
        setSaveStatus("error");
        setSaveErrorMsg(
          `0 / ${moves.length} moves saved. ${errors[0].reason}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`,
        );
        setTimeout(() => setSaveStatus("idle"), 6000);
        return;
      }
      setSaveStatus("success");
      setSaveErrorMsg(
        errors.length > 0
          ? `${applied} saved, ${errors.length} rejected: ${errors[0].reason}`
          : null,
      );
      setEditMode(false);
      setPendingMoves(new Map());
      setLoading(true);
      setRefreshKey((k) => k + 1);
      setTimeout(() => {
        setSaveStatus("idle");
        setSaveErrorMsg(null);
      }, 4000);
    } catch {
      setSaveStatus("error");
      setSaveErrorMsg("Network error");
      setTimeout(() => setSaveStatus("idle"), 6000);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const assignmentId = String(event.active.id);
    const baseTimeline = data?.timeline ?? [];
    const item = baseTimeline.find((t) => t.assignmentId === assignmentId);
    if (item) setDraggingAssignment(item);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingAssignment(null);
    if (!event.over) return;
    const assignmentId = String(event.active.id);
    const [factoryId, date] = String(event.over.id).split("|");
    if (!factoryId || !date) return;
    const item = data?.timeline.find((t) => t.assignmentId === assignmentId);
    if (!item) return;
    // No-op if dropping onto current slot, account for pending move
    const current = pendingMoves.get(assignmentId);
    const currFactory = current?.factoryId ?? item.factoryId;
    const currDate = current?.productionDate ?? item.productionDate;
    if (currFactory === factoryId && currDate === date) return;

    setPendingMoves((prev) => {
      const next = new Map(prev);
      // If dropping back to original, remove the pending move
      if (factoryId === item.factoryId && date === item.productionDate) {
        next.delete(assignmentId);
      } else {
        next.set(assignmentId, {
          factoryId,
          productionDate: date,
          original: {
            factoryId: item.factoryId,
            productionDate: item.productionDate,
          },
        });
      }
      return next;
    });
  };

  // Manual notify handler — POSTs scheduleConflicts to /api/schedule/notify.
  // Banner is preview-driven (T4D); run no longer emits conflicts.
  const handleSendNotifications = async () => {
    if (scheduleConflicts.length === 0) return;
    setNotifyStatus("sending");
    // Notify schema requires applicantEmail to be a string|null but at least
    // one of applicant/admin email needs to exist for a real send. Drop
    // entries with neither so we never POST orders the server would silently
    // skip (and so a 100%-skip set doesn't read as "sent").
    const payloadOrders = scheduleConflicts.filter(
      (o) => o.applicantEmail || o.adminEmail,
    );
    if (payloadOrders.length === 0) {
      setNotifyStatus("error");
      return;
    }
    try {
      const res = await fetch("/api/schedule/notify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: payloadOrders }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const failedCount = Array.isArray(body.failed) ? body.failed.length : 0;
        const sentCount = Array.isArray(body.sent)
          ? body.sent.length
          : payloadOrders.length;
        setNotifiedCount(sentCount);
        setNotifyStatus(failedCount === 0 && sentCount > 0 ? "sent" : "error");
      } else {
        setNotifyStatus("error");
      }
    } catch {
      setNotifyStatus("error");
    }
  };

  const handleLogout = async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  };

  // Effective timeline/capacities/conflicts/factories/diffs:
  // - previewData wins
  // - else if editMode + pendingMoves, apply moves locally
  // - else use server data
  const effective = useMemo(() => {
    if (previewData) {
      return {
        factories: previewData.factories,
        timeline: previewData.timeline,
        dailyCapacities: previewData.dailyCapacities,
        conflicts: previewData.conflicts,
        diffs: previewData.diffs,
      };
    }
    if (!data) return null;
    if (editMode && pendingMoves.size > 0) {
      const movedTimeline: TimelineItem[] = data.timeline.map((t) => {
        const move = pendingMoves.get(t.assignmentId);
        if (!move) return t;
        return {
          ...t,
          factoryId: move.factoryId,
          productionDate: move.productionDate,
        };
      });
      // Recompute daily capacities from moved timeline
      const usedByCell = new Map<string, number>();
      for (const t of movedTimeline) {
        const key = `${t.factoryId}__${t.productionDate}`;
        usedByCell.set(key, (usedByCell.get(key) ?? 0) + t.assignedQuantity);
      }
      const factoryMaxById = new Map(
        data.factories.map((f) => [f.id, f.maxCapacity]),
      );
      const dailyCapMap = new Map<string, DailyCapacityInfo>();
      for (const dc of data.dailyCapacities) {
        dailyCapMap.set(`${dc.factoryId}__${dc.date}`, { ...dc });
      }
      for (const [key, used] of usedByCell.entries()) {
        const existing = dailyCapMap.get(key);
        const [factoryId, date] = key.split("__");
        if (existing) {
          existing.usedCapacity = used;
        } else {
          dailyCapMap.set(key, {
            factoryId,
            date,
            maxCapacity: factoryMaxById.get(factoryId) ?? 0,
            usedCapacity: used,
          });
        }
      }
      // Also clear used capacity for cells now empty
      for (const [key, dc] of dailyCapMap.entries()) {
        if (!usedByCell.has(key)) {
          dc.usedCapacity = 0;
        }
      }
      // Recompute conflicts locally
      const conflicts: ConflictInfo[] = [];
      for (const dc of dailyCapMap.values()) {
        if (dc.usedCapacity > dc.maxCapacity) {
          const affected = movedTimeline
            .filter(
              (t) =>
                t.factoryId === dc.factoryId && t.productionDate === dc.date,
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
      for (const t of movedTimeline) {
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
      return {
        factories: data.factories,
        timeline: movedTimeline,
        dailyCapacities: Array.from(dailyCapMap.values()),
        conflicts,
        diffs: data.diffs,
      };
    }
    return {
      factories: data.factories,
      timeline: data.timeline,
      dailyCapacities: data.dailyCapacities,
      conflicts: data.conflicts,
      diffs: data.diffs,
    };
  }, [data, previewData, editMode, pendingMoves]);
  const handleCreateOrder = async (values: OrderEditorValues) => {
    if (!values.name) {
      throw new Error("Name is required.");
    }
    if (!values.type || !["A", "B", "C"].includes(values.type)) {
      throw new Error("Type must be A, B, or C.");
    }
    if (!values.dueDate) {
      throw new Error("Due date is required.");
    }
    const quantity = Number(values.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive integer.");
    }

    const res = await fetch("/api/orders", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        type: values.type,
        dueDate: new Date(values.dueDate).toISOString(),
        quantity,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message ?? `Create order failed (${res.status})`);
    }

    setLoading(true);
    setFetchError(null);
    setRefreshKey((k) => k + 1);
  };

  const handleUpdateOrder = async (values: OrderEditorValues) => {
    if (!editOrder?.orderId) {
      throw new Error("Order ID is missing.");
    }

    const body: Record<string, unknown> = {};
    if (values.name.trim()) body.name = values.name.trim();
    if (values.quantity.trim()) {
      const quantity = Number(values.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("Quantity must be a positive integer.");
      }
      body.quantity = quantity;
    }

    if (Object.keys(body).length === 0) {
      throw new Error("Name or quantity is required.");
    }

    const res = await fetch(`/api/orders/${editOrder.orderId}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const bodyJson = await res.json().catch(() => ({}));
      throw new Error(
        bodyJson.message ?? `Update order failed (${res.status})`,
      );
    }

    setLoading(true);
    setFetchError(null);
    setRefreshKey((k) => k + 1);
  };

  // Load simulation state on mount
  useEffect(() => {
    if (!session) return;
    fetch("/api/system/simulation", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((body) => {
        setSimMode(!!body.isSimulationMode);
        if (body.simulationDate) {
          setSimDate(format(new Date(body.simulationDate), "yyyy-MM-dd"));
        }
      })
      .catch(() => {});
  }, [session]);

  const patchSim = async (patch: {
    isSimulationMode?: boolean;
    simulationDate?: string | null;
  }) => {
    setSimLoading(true);
    try {
      const res = await fetch("/api/system/simulation", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const body = await res.json();
        setSimMode(!!body.isSimulationMode);
        if (body.simulationDate) {
          setSimDate(format(new Date(body.simulationDate), "yyyy-MM-dd"));
        } else {
          setSimDate("");
        }
        setLoading(true);
        setFetchError(null);
        setRefreshKey((k) => k + 1);
      }
    } finally {
      setSimLoading(false);
    }
  };

  const handleTimeModeChange = (nextIsManual: boolean) => {
    if (!nextIsManual) {
      patchSim({ isSimulationMode: false });
      return;
    }

    patchSim({
      isSimulationMode: true,
      simulationDate: simDate
        ? dateInputToIso(simDate)
        : new Date().toISOString(),
    });
  };

  const handleSimDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSimDate(val);
    if (val) {
      patchSim({ simulationDate: dateInputToIso(val) });
    }
  };

  const stepSimDate = (days: number) => {
    const base = simDate ? new Date(simDate) : new Date();
    base.setDate(base.getDate() + days);
    const next = format(base, "yyyy-MM-dd");
    setSimDate(next);
    patchSim({ simulationDate: dateInputToIso(next) });
  };

  // Build date columns
  const dates = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (end < start) return [];
    return eachDayOfInterval({ start, end }).map((d) => toDateStr(d));
  }, [startDate, endDate]);

  // Cell map (uses effective data so preview/edit overlays render correctly)
  const cellMap = useMemo(
    () =>
      effective
        ? buildCellMap(
            {
              factories: effective.factories,
              timeline: effective.timeline,
              conflicts: effective.conflicts,
              dailyCapacities: effective.dailyCapacities,
              diffs: effective.diffs,
              salesContext: data?.salesContext,
              today: data?.today ?? "",
            },
            dates,
          )
        : new Map(),
    [effective, dates, data?.salesContext, data?.today],
  );

  // Group factories by productionType
  const groups = useMemo(() => {
    if (!effective) return [];
    const map = new Map<string, FactoryInfo[]>();
    for (const f of effective.factories) {
      const existing = map.get(f.productionType) ?? [];
      map.set(f.productionType, [...existing, f]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [effective]);

  // Diff lookup: orderId → DiffEntry
  const diffByOrderId = useMemo(() => {
    const map = new Map<string, DiffEntry>();
    for (const d of effective?.diffs ?? []) {
      map.set(d.orderId, d);
    }
    return map;
  }, [effective]);

  // SALES: set of this user's order IDs visible in the Gantt
  const myOrderIdSet = useMemo(
    () => new Set(data?.salesContext?.myOrderIds ?? []),
    [data],
  );

  // SALES: latest productionDate (ETA) per order across all assignments
  const etaByOrderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of effective?.timeline ?? []) {
      if (!myOrderIdSet.has(item.orderId)) continue;
      const current = map.get(item.orderId);
      if (!current || item.productionDate > current) {
        map.set(item.orderId, item.productionDate);
      }
    }
    return map;
  }, [effective, myOrderIdSet]);

  // Per-cell: does it contain any rescheduled order?
  const rescheduledCells = useMemo(() => {
    const set = new Set<string>();
    for (const item of effective?.timeline ?? []) {
      if (diffByOrderId.has(item.orderId)) {
        set.add(`${item.factoryId}__${item.productionDate}`);
      }
    }
    return set;
  }, [effective, diffByOrderId]);

  // Set of assignmentIds that have a pending edit-mode move
  const movedAssignmentIds = useMemo(
    () => new Set(pendingMoves.keys()),
    [pendingMoves],
  );

  // Selected cell detail
  const selectedCellData = useMemo(() => {
    if (!selectedCell || !effective) return null;
    const key = `${selectedCell.factoryId}__${selectedCell.date}`;
    return cellMap.get(key) ?? null;
  }, [selectedCell, cellMap, effective]);

  const selectedFactory = useMemo(() => {
    if (!selectedCell || !effective) return null;
    return (
      effective.factories.find((f) => f.id === selectedCell.factoryId) ?? null
    );
  }, [selectedCell, effective]);

  // Summary counts
  const capacityConflicts =
    effective?.conflicts.filter((c) => c.conflictType === "CAPACITY").length ??
    0;
  const dueDateConflicts =
    effective?.conflicts.filter((c) => c.conflictType === "DUE_DATE").length ??
    0;
  const rescheduledCount = effective?.diffs.length ?? 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Loading session...
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Redirecting to login...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      {/* Top bar */}
      <div className="flex-none bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-semibold text-gray-900">
            Production Schedule
          </h1>
          <p className="text-xs text-gray-500">
            Factory gantt — click a cell to inspect orders
          </p>
        </div>

        <nav
          className="flex items-center gap-2 flex-wrap"
          aria-label="Dashboard navigation"
        >
          <a
            href="/orders"
            className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Orders
          </a>
          <a
            href="/visualization"
            className="text-xs font-medium px-2.5 py-1.5 rounded border border-blue-200 bg-blue-50 text-blue-700"
          >
            Visualization
          </a>
          <a
            href="/visualization/dashboard"
            className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Dashboard
          </a>
          <a
            href="/users"
            className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Users
          </a>
          <a
            href="/profile"
            className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Profile
          </a>
        </nav>

        <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1 bg-gray-50">
          <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
            Signed in as:
          </span>
          <span className="text-xs font-semibold text-gray-800">
            {session.user.username}
          </span>
          <span className="text-xs text-gray-500">({session.user.email})</span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
            {session.user.role}
          </span>
          {productionType && (
            <span className="text-xs text-gray-500">Type {productionType}</span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs font-medium px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Logout
          </button>
        </div>

        {/* Schedule controls (admin/superadmin only) */}
        {!isSales && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Reschedule policy dropdown */}
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <span className="text-gray-500">Policy</span>
              <select
                value={reschedulePolicy}
                onChange={(e) =>
                  setReschedulePolicy(
                    e.target.value as
                      | "GLOBAL_OPTIMIZE"
                      | "PRIORITY_RETAIN"
                      | "GAP_FILLING",
                  )
                }
                disabled={editMode || previewLoading}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="GAP_FILLING">填補空隙 (GAP_FILLING)</option>
                <option value="PRIORITY_RETAIN">
                  優先保留現有 (PRIORITY_RETAIN)
                </option>
                <option value="GLOBAL_OPTIMIZE">
                  全域最佳化 (GLOBAL_OPTIMIZE)
                </option>
              </select>
            </label>

            <button
              onClick={handlePreviewSchedule}
              disabled={
                previewLoading || editMode || scheduleStatus === "running"
              }
              className={`text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
                previewLoading || editMode
                  ? "bg-gray-100 text-gray-600 border-gray-200 cursor-not-allowed"
                  : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {previewLoading ? "Previewing…" : "🔍 Preview"}
            </button>

            <button
              onClick={() => handleRunSchedule()}
              disabled={
                scheduleStatus === "running" || editMode || previewLoading
              }
              className={`text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
                scheduleStatus === "running" || editMode
                  ? "bg-gray-100 text-gray-600 border-gray-200 cursor-not-allowed"
                  : "bg-green-700 text-white border-green-700 hover:bg-green-800"
              }`}
            >
              {scheduleStatus === "running"
                ? "Running…"
                : `▶ Run (Type ${productionType || "-"})`}
            </button>

            {!editMode && !previewData && (
              <button
                onClick={handleEnterEditMode}
                className="text-xs font-medium px-3 py-1.5 rounded border bg-white text-purple-700 border-purple-300 hover:bg-purple-50"
              >
                ✏️ Edit
              </button>
            )}

            {scheduleStatus === "success" && (
              <span className="text-xs text-green-600 font-medium">
                Scheduled ✓
              </span>
            )}
            {scheduleStatus === "conflict" && (
              <span className="text-xs text-yellow-600 font-medium">
                Already running
              </span>
            )}
            {scheduleStatus === "error" && (
              <span className="text-xs text-red-600 font-medium">Failed</span>
            )}
            {saveStatus === "success" && (
              <span className="text-xs text-green-600 font-medium">
                {saveErrorMsg ? `Saved ✓ (${saveErrorMsg})` : "Saved ✓"}
              </span>
            )}
            {saveStatus === "error" && (
              <span
                className="text-xs text-red-600 font-medium"
                title={saveErrorMsg ?? ""}
              >
                Save failed: {saveErrorMsg ?? "unknown"}
              </span>
            )}
          </div>
        )}

        {/* Date range */}
        <div className="flex items-center gap-2 ml-auto">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setLoading(true);
              setFetchError(null);
            }}
            className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <span className="text-gray-400 text-sm">→</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setLoading(true);
              setFetchError(null);
            }}
            className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-2 text-xs">
          {capacityConflicts > 0 && (
            <span className="flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 rounded px-2 py-1 font-medium">
              ⚡ {capacityConflicts} capacity
            </span>
          )}
          {dueDateConflicts > 0 && (
            <span className="flex items-center gap-1 bg-orange-50 text-orange-700 border border-orange-200 rounded px-2 py-1 font-medium">
              ⏰ {dueDateConflicts} due date
            </span>
          )}
          {rescheduledCount > 0 && (
            <span className="flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-1 font-medium">
              ↕ {rescheduledCount} rescheduled
            </span>
          )}
        </div>
      </div>

      {/* Simulation mode bar */}
      <div
        className={`flex-none px-6 py-2 flex items-center gap-3 flex-wrap border-b text-xs ${
          simMode ? "bg-amber-50 border-amber-200" : "bg-white border-gray-100"
        }`}
      >
        <span className="font-medium text-gray-700">Time Mode</span>
        <div className="inline-flex rounded border border-gray-300 bg-white overflow-hidden">
          <button
            type="button"
            onClick={() => handleTimeModeChange(false)}
            disabled={simLoading || !simMode}
            className={`px-2.5 py-1 font-semibold transition-colors ${
              !simMode
                ? "bg-green-600 text-white"
                : "text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            }`}
          >
            Auto
          </button>
          <button
            type="button"
            onClick={() => handleTimeModeChange(true)}
            disabled={simLoading || simMode}
            className={`px-2.5 py-1 font-semibold border-l border-gray-300 transition-colors ${
              simMode
                ? "bg-amber-500 text-white"
                : "text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            }`}
          >
            Manual
          </button>
        </div>
        {simMode && (
          <>
            <button
              type="button"
              onClick={() => stepSimDate(-1)}
              disabled={simLoading}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            >
              ← -1d
            </button>
            <input
              type="date"
              value={simDate}
              onChange={handleSimDateChange}
              disabled={simLoading}
              className="border border-amber-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-400 bg-white"
            />
            <button
              type="button"
              onClick={() => stepSimDate(1)}
              disabled={simLoading}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            >
              +1d →
            </button>
            <span className="text-amber-700 font-semibold bg-amber-100 border border-amber-200 rounded px-2 py-0.5">
              Simulating: {simDate || "—"}
            </span>
          </>
        )}
        {!simMode && (
          <span className="text-green-700 font-semibold bg-green-50 border border-green-200 rounded px-2 py-0.5">
            ● Auto: live time
          </span>
        )}
      </div>

      {/* Preview banner */}
      {previewData && (
        <div className="flex-none px-6 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3">
          <span className="text-xs font-semibold text-indigo-700 shrink-0">
            🔍 Preview · {previewData.algorithm}
          </span>
          <span className="text-xs text-indigo-700">
            {previewData.diffs.length} order(s) would be rescheduled
            {previewData.unscheduledOrders.length > 0 &&
              `, ${previewData.unscheduledOrders.length} cannot fit`}
            . Capacity conflicts:{" "}
            {
              previewData.conflicts.filter((c) => c.conflictType === "CAPACITY")
                .length
            }
            , due-date conflicts:{" "}
            {
              previewData.conflicts.filter((c) => c.conflictType === "DUE_DATE")
                .length
            }
            .
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleApplyPreview}
              disabled={
                !previewId ||
                applying ||
                editMode ||
                scheduleStatus === "running"
              }
              className="text-xs font-medium px-3 py-1.5 rounded border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:border-gray-300"
            >
              {applying ? "套用中…" : "✓ Apply"}
            </button>
            <button
              onClick={handleDiscardPreview}
              disabled={applying}
              className="text-xs font-medium px-3 py-1.5 rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {previewError && (
        <div className="flex-none px-6 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          Preview failed: {previewError}
          <button
            onClick={() => setPreviewError(null)}
            className="ml-2 text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}

      {/* Edit-mode banner */}
      {editMode && (
        <div className="flex-none px-6 py-2 bg-purple-50 border-b border-purple-200 flex items-center gap-3">
          <span className="text-xs font-semibold text-purple-700 shrink-0">
            ✏️ Edit mode
          </span>
          <span className="text-xs text-purple-700">
            Drag assignment chips between cells.{" "}
            <span className="font-semibold">{pendingMoves.size}</span> pending
            move(s).
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleSaveEdits}
              disabled={saveStatus === "saving"}
              className="text-xs font-medium px-3 py-1.5 rounded border bg-purple-600 text-white border-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:border-gray-300"
            >
              {saveStatus === "saving" ? "Saving…" : "💾 Save Changes"}
            </button>
            <button
              onClick={handleDiscardEdits}
              className="text-xs font-medium px-3 py-1.5 rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Scheduling conflict notification panel */}
      {scheduleConflicts.length > 0 && (
        <div
          className={`flex-none px-6 py-3 border-b text-xs ${
            emailsAutoSent || notifyStatus === "sent"
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          {emailsAutoSent || notifyStatus === "sent" ? (
            <div className="flex items-center justify-between">
              <span className="text-green-700 font-medium">
                {`已寄出 ${
                  notifyStatus === "sent"
                    ? notifiedCount || scheduleConflicts.length
                    : scheduleConflicts.length
                } 封通知 (Notification emails sent for ${
                  notifyStatus === "sent"
                    ? notifiedCount || scheduleConflicts.length
                    : scheduleConflicts.length
                } order(s) that could not be scheduled.)`}
              </span>
              <button
                type="button"
                onClick={() => setScheduleConflicts([])}
                className="text-green-400 hover:text-green-600 shrink-0"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-amber-800 font-semibold">
                    {scheduleConflicts.length} order(s) could not be scheduled:
                  </span>
                  <button
                    type="button"
                    onClick={handleSendNotifications}
                    disabled={
                      notifyStatus === "sending" ||
                      scheduleConflicts.length === 0
                    }
                    className={`px-2.5 py-1 rounded border font-medium transition-colors ${
                      notifyStatus === "sending" ||
                      scheduleConflicts.length === 0
                        ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                        : "bg-amber-700 text-white border-amber-700 hover:bg-amber-800"
                    }`}
                  >
                    {notifyStatus === "sending" ? "Sending…" : "Notify"}
                  </button>
                  {notifyStatus === "error" && (
                    <span className="text-red-600 font-medium">
                      Some emails failed — check server logs.
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setScheduleConflicts([])}
                  className="text-amber-400 hover:text-amber-600 shrink-0"
                >
                  ✕
                </button>
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-amber-700">
                {scheduleConflicts.map((o) => (
                  <li key={o.id}>
                    <span className="font-medium">{o.name}</span>
                    {" — qty "}
                    <span>{o.quantity}</span>
                    {", due "}
                    <span>{o.dueDate}</span>
                    {o.applicantEmail && (
                      <>
                        {" ("}
                        <span className="text-amber-600">
                          {o.applicantEmail}
                        </span>
                        {")"}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex-none px-6 py-2 flex items-center gap-4 text-xs text-gray-500 bg-white border-b border-gray-100">
        <span className="font-medium">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-blue-400 inline-block" />{" "}
          Normal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-yellow-400 inline-block" />{" "}
          High load (&gt;80%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-orange-400 inline-block" /> Due
          date conflict
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />{" "}
          Capacity exceeded
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px]">⚠️</span> Conflict
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-purple-500">↕</span>{" "}
          Rescheduled
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-500">×N</span> Order
          count
        </span>
      </div>

      {/* Gantt body */}
      <div className="flex-1 overflow-hidden flex">
        {/* Pending sidebar (SALES only) */}
        {isSales && data?.salesContext && !loading && !fetchError && (
          <PendingSidebar
            orders={data.salesContext.pendingOrders}
            today={data.today}
            onEditOrder={(order) => setEditOrder(order)}
            onCreate={() => setCreateOpen(true)}
          />
        )}

        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Loading…
            </div>
          )}

          {!loading && fetchError && (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <span className="text-2xl">
                {fetchError.status === 403 ? "🔒" : "⚠️"}
              </span>
              <p className="text-sm font-medium text-gray-700">
                {fetchError.status === 401 &&
                  "Unauthorized — invalid or missing token"}
                {fetchError.status === 403 &&
                  "Forbidden — this role cannot view the schedule"}
                {fetchError.status === 0 &&
                  "Network error — is the server running?"}
                {fetchError.status > 0 &&
                  fetchError.status !== 401 &&
                  fetchError.status !== 403 &&
                  `Error ${fetchError.status}: ${fetchError.message}`}
              </p>
            </div>
          )}

          {!loading && !fetchError && data && (
            <DndContext
              sensors={sensors}
              onDragStart={editMode ? handleDragStart : undefined}
              onDragEnd={
                editMode ? handleDragEnd : () => setDraggingAssignment(null)
              }
            >
              <table
                className="border-collapse text-xs"
                style={{ tableLayout: "fixed" }}
              >
                <thead>
                  <tr>
                    {/* Factory label column */}
                    <th className="sticky left-0 top-0 z-30 bg-white border border-gray-200 w-36 min-w-36 px-3 py-2 text-left text-gray-500 font-medium">
                      Factory
                    </th>
                    {/* Date columns */}
                    {dates.map((d) => {
                      const day = parseISO(d);
                      const isWeekend =
                        day.getDay() === 0 || day.getDay() === 6;
                      return (
                        <th
                          key={d}
                          className={`sticky top-0 z-20 border border-gray-200 w-[72px] min-w-[72px] px-1 py-2 text-center font-medium ${isWeekend ? "bg-gray-50 text-gray-400" : "bg-white text-gray-600"}`}
                        >
                          <div>{format(day, "d")}</div>
                          <div className="text-[9px] font-normal opacity-70">
                            {format(day, "EEE")}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([type, factories]) => (
                    <React.Fragment key={type}>
                      {/* Group header row */}
                      <tr>
                        <td
                          colSpan={dates.length + 1}
                          className="sticky left-0 bg-gray-100 border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 text-[11px] uppercase tracking-wide"
                        >
                          Production Type {type}
                        </td>
                      </tr>

                      {/* Factory rows */}
                      {factories.map((factory) => (
                        <tr key={factory.id} className="hover:bg-gray-50/50">
                          <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                            <div>{factory.label}</div>
                            <div className="text-[9px] text-gray-400 font-normal">
                              max {factory.maxCapacity.toLocaleString()}
                            </div>
                          </td>
                          {dates.map((date) => {
                            const key = `${factory.id}__${date}`;
                            const cell = cellMap.get(key)!;
                            const isMyOrder = isSales
                              ? cell.items.some((i: TimelineItem) =>
                                  myOrderIdSet.has(i.orderId),
                                )
                              : false;
                            return (
                              <GanttCell
                                key={key}
                                cell={cell}
                                hasRescheduled={rescheduledCells.has(key)}
                                isMyOrder={isMyOrder}
                                isSales={isSales}
                                editMode={editMode}
                                movedAssignmentIds={movedAssignmentIds}
                                onClick={() =>
                                  setSelectedCell({
                                    factoryId: factory.id,
                                    date,
                                  })
                                }
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              <DragOverlay>
                {draggingAssignment && (
                  <div className="text-[9px] leading-tight rounded px-1 py-0.5 bg-blue-100 border border-blue-400 text-blue-800 shadow-lg">
                    <span className="font-semibold truncate block max-w-[80px]">
                      {draggingAssignment.orderName}
                    </span>
                    <span className="text-[8px] opacity-70">
                      ×{draggingAssignment.assignedQuantity}
                    </span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </div>

      {/* Detail panel overlay */}
      {selectedCell && selectedCellData && selectedFactory && (
        <>
          <div
            className="fixed inset-0 bg-black/10 z-40"
            onClick={() => setSelectedCell(null)}
          />
          <DetailPanel
            cell={selectedCellData}
            factory={selectedFactory}
            diffByOrderId={diffByOrderId}
            myOrderIds={data?.salesContext?.myOrderIds}
            etaByOrderId={etaByOrderId}
            onEditOrder={(order) => setEditOrder(order)}
            onClose={() => setSelectedCell(null)}
          />
        </>
      )}

      <OrderFormModal
        open={createOpen}
        title="Create Order"
        mode="create"
        initialValues={{
          name: "",
          quantity: "",
          type: "A",
          dueDate: "2026-12-31",
        }}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateOrder}
      />

      <OrderFormModal
        open={editOrder !== null}
        title="Update Order"
        mode="edit"
        initialValues={{
          name: editOrder?.name ?? "",
          quantity: editOrder?.quantity ?? "",
          orderId: editOrder?.orderId,
          status: editOrder?.status,
          dueDate: editOrder?.dueDate,
          type: editOrder?.type,
        }}
        onClose={() => setEditOrder(null)}
        onSubmit={handleUpdateOrder}
      />
    </div>
  );
}
