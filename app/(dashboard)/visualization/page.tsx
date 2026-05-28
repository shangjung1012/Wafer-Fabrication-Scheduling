"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  format,
  eachDayOfInterval,
  parseISO,
  differenceInDays,
  addDays,
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
import { OrderCsvDropZone } from "@/components/orders/OrderCsvDropZone";
import { importOrdersFromCsv } from "@/components/orders/order-csv";
import {
  DraggableAssignmentChip,
  DraggablePendingOrderCard,
  DraggableSplitChip,
  DroppableCell,
} from "./_components/edit-cell";
import {
  AlertTriangle,
  ArrowDownUp,
  Check,
  Clock,
  Crown,
  Lock,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  X,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function toDateStr(d: Date) {
  return format(d, "yyyy-MM-dd");
}

/** Overlay pending order-level `isFixed` edits onto timeline rows (edit mode). */
function applyPendingIsFixedByOrder(
  timeline: TimelineItem[],
  pending: Map<string, boolean>,
): TimelineItem[] {
  if (pending.size === 0) return timeline;
  return timeline.map((t) => {
    const p = pending.get(t.orderId);
    if (p === undefined) return t;
    if (t.isFixed === p) return t;
    return { ...t, isFixed: p };
  });
}

/** Overlay pending order-level `isPrioritized` edits onto timeline rows (edit mode). */
function applyPendingIsPrioritizedByOrder(
  timeline: TimelineItem[],
  pending: Map<string, boolean>,
): TimelineItem[] {
  if (pending.size === 0) return timeline;
  return timeline.map((t) => {
    const p = pending.get(t.orderId);
    if (p === undefined) return t;
    if (t.isPrioritized === p) return t;
    return { ...t, isPrioritized: p };
  });
}

/** Default window: 10 calendar days starting 2 days before anchor (anchor - 2 through anchor + 7). */
function defaultTimelineRange(anchorDayYmd: string) {
  const startDate = toDateStr(addDays(parseISO(anchorDayYmd.slice(0, 10)), -2));
  const endDate = toDateStr(addDays(parseISO(startDate), 9));
  return { startDate, endDate };
}

function dateInputToIso(value: string) {
  return `${value}T00:00:00.000Z`;
}

function toDateInputValue(value?: string) {
  if (!value) return "";
  try {
    return format(parseISO(value), "yyyy-MM-dd");
  } catch {
    return value.slice(0, 10);
  }
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
    applicantUsername?: string | null;
    applicant?: { username?: string | null };
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
  const applicantUsernameByOrderId = new Map(
    (baseTimeline?.timeline ?? []).map((t) => [
      t.orderId,
      t.applicantUsername ?? t.applicantId,
    ]),
  );

  const toIsoDate = (d: string | Date | undefined): string => {
    if (!d) return "";
    if (typeof d === "string") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      if (d.includes("T")) return d.split("T")[0];
      return d.slice(0, 10);
    }
    if (d instanceof Date) {
      return format(d, "yyyy-MM-dd");
    }
    return String(d).slice(0, 10);
  };

  // Build TimelineItem[] from every assignment on every order in newSchedule.
  const timeline: TimelineItem[] = [];
  let synthAssignmentSeq = 0;
  const previewedOrderIds = new Set(newSchedule.map((o) => o.id));
  for (const order of newSchedule) {
    const orderIsFixed = Boolean(
      (order as { isFixed?: boolean }).isFixed === true,
    );
    const orderIsPrioritized = Boolean(
      (order as { isPrioritized?: boolean }).isPrioritized === true,
    );
    for (const a of order.assignments ?? []) {
      if (!a.factoryId || !a.productionDate) continue;
      timeline.push({
        assignmentId: a.id ?? `preview-${order.id}-${synthAssignmentSeq++}`,
        orderId: a.orderId ?? order.id,
        orderName: order.name ?? order.id,
        isFixed: orderIsFixed,
        isPrioritized: orderIsPrioritized,
        factoryId: a.factoryId,
        productionDate: toIsoDate(a.productionDate),
        assignedQuantity: a.assignedQuantity ?? 0,
        status: (a.status as TimelineItem["status"]) ?? "SCHEDULED",
        dueDate: toIsoDate(order.dueDate),
        applicantId: order.applicantId ?? "",
        applicantUsername:
          order.applicantUsername ??
          order.applicant?.username ??
          applicantUsernameByOrderId.get(order.id) ??
          null,
        lastModifiedById: order.lastModifiedById ?? null,
      });
    }
  }

  // When previewing a subset (targetOrderIds), the API only returns those orders.
  // Carry over the baseline timeline items for everything else so existing
  // scheduled orders stay visible on the preview.
  for (const t of baseTimeline?.timeline ?? []) {
    if (!previewedOrderIds.has(t.orderId)) {
      timeline.push(t);
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

/** First row wins per assignmentId (timeline should not duplicate; avoids duplicate React keys in cells). */
function dedupeTimelineItemsByAssignmentId(
  items: TimelineItem[],
): TimelineItem[] {
  const seen = new Set<string>();
  const out: TimelineItem[] = [];
  for (const t of items) {
    if (seen.has(t.assignmentId)) continue;
    seen.add(t.assignmentId);
    out.push(t);
  }
  return out;
}

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
      const items = dedupeTimelineItemsByAssignmentId(
        data.timeline.filter(
          (t) => t.factoryId === factory.id && t.productionDate === date,
        ),
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

  // Whole-cell tone from assignment statuses (no conflict on this cell).
  const statuses = cell.items.map((i) => i.status);
  const anyInProduction = statuses.some((s) => s === "IN_PRODUCTION");
  const allCompleted =
    statuses.length > 0 && statuses.every((s) => s === "COMPLETED");
  if (anyInProduction) {
    return {
      bg: "bg-emerald-50",
      barColor: "bg-emerald-500",
      fillRatio: Math.min(ratio, 1),
    };
  }
  if (allCompleted) {
    return {
      bg: "grayscale bg-neutral-100",
      barColor: "bg-neutral-500",
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
  IN_PRODUCTION: "bg-emerald-100 text-emerald-900",
  COMPLETED: "bg-neutral-200 text-neutral-600 grayscale",
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

/** Full-card surface for an assignment row in the detail panel. */
function detailOrderCardClass(
  item: TimelineItem,
  hasPreviewDiff: boolean,
): string {
  if (hasPreviewDiff) {
    return "border-purple-300 bg-purple-50/70 hover:border-purple-400";
  }
  if (item.status === "IN_PRODUCTION") {
    return "border-emerald-300 bg-emerald-50/95 hover:border-emerald-500";
  }
  if (item.status === "COMPLETED") {
    return "grayscale border-neutral-300 bg-neutral-100/95 hover:border-neutral-400";
  }
  if (item.status === "CANCELLED") {
    return "border-rose-200 bg-rose-50/95 hover:border-rose-300";
  }
  return "border-slate-200 bg-slate-50/80 hover:border-slate-300";
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
  editMode,
  isSales = false,
  onEditOrder,
  onToggleOrderFixed,
  onToggleOrderPrioritized,
  onClose,
}: {
  cell: CellData;
  factory: FactoryInfo;
  diffByOrderId: Map<string, DiffEntry>;
  myOrderIds?: string[];
  etaByOrderId?: Map<string, string>;
  /** When true, show per-order lock (isFixed) toggle for SCHEDULED rows. */
  editMode?: boolean;
  /** SALES: only own orders get full detail; others see aggregate counts only. */
  isSales?: boolean;
  onEditOrder: (order: OrderEditorValues) => void;
  onToggleOrderFixed?: (orderId: string, next: boolean) => void;
  onToggleOrderPrioritized?: (orderId: string, next: boolean) => void;
  onClose: () => void;
}) {
  const myOrderIdSet = new Set(myOrderIds ?? []);
  const myOrderItems = cell.items.filter((i) => myOrderIdSet.has(i.orderId));
  const otherItems = isSales
    ? cell.items.filter((i) => !myOrderIdSet.has(i.orderId))
    : [];
  const otherOrderCount = new Set(otherItems.map((i) => i.orderId)).size;
  const visibleConflicts = isSales
    ? cell.conflicts.filter(
        (c) =>
          c.conflictType === "CAPACITY" ||
          c.orderIds.some((id) => myOrderIdSet.has(id)),
      )
    : cell.conflicts;
  const detailItems = isSales ? myOrderItems : cell.items;
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
          type="button"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close panel"
        >
          <X className="h-5 w-5" strokeWidth={2} />
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
      {visibleConflicts.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Conflicts
          </p>
          {visibleConflicts.map((c, i) => (
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
        {isSales && otherOrderCount > 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-600">
            <p className="font-semibold text-gray-700">Other orders</p>
            <p className="mt-1">
              {otherOrderCount} order{otherOrderCount === 1 ? "" : "s"} (
              {otherItems.length} assignment
              {otherItems.length === 1 ? "" : "s"}) in this cell — details are
              hidden.
            </p>
            <p className="mt-1 text-gray-500">
              Capacity usage above includes all assignments on this day.
            </p>
          </div>
        )}

        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {isSales
            ? `My orders (${myOrderItems.length})`
            : `Orders (${cell.items.length})`}
        </p>
        {detailItems.length === 0 && (
          <p className="text-sm text-gray-400">
            {isSales
              ? "None of your orders are scheduled in this cell."
              : "No assignments on this day."}
          </p>
        )}
        {detailItems.map((item) => {
          const diff = diffByOrderId.get(item.orderId);
          return (
            <div
              key={item.orderId}
              className={`border rounded-lg p-3 transition-colors ${detailOrderCardClass(item, Boolean(diff))}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span
                  className={`text-sm font-medium inline-flex items-center gap-1 min-w-0 ${item.status === "COMPLETED" ? "text-neutral-800" : "text-gray-900"}`}
                >
                  {item.status === "SCHEDULED" && item.isFixed ? (
                    <Lock
                      className="h-3.5 w-3.5 shrink-0 text-gray-600"
                      aria-hidden
                    />
                  ) : null}
                  {item.status === "SCHEDULED" && item.isPrioritized ? (
                    <Crown
                      className="h-3.5 w-3.5 shrink-0 text-amber-600"
                      aria-hidden
                    />
                  ) : null}
                  <span className="truncate">{item.orderName}</span>
                </span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  {item.status === "SCHEDULED" &&
                    (!isSales || myOrderIdSet.has(item.orderId)) && (
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
                            isPrioritized: item.isPrioritized,
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
                    {item.dueDate < item.productionDate ? (
                      <AlertTriangle
                        className="inline h-3.5 w-3.5 ml-1 align-[-2px] text-red-500"
                        aria-hidden
                      />
                    ) : null}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>Applicant</span>
                  <span
                    className="font-medium text-blue-700 text-right truncate"
                    title={item.applicantId}
                  >
                    {item.applicantUsername ?? item.applicantId ?? "—"}
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
                {editMode &&
                  item.status === "SCHEDULED" &&
                  onToggleOrderFixed && (
                    <label
                      className="flex items-center justify-between gap-2 pt-2 mt-1 border-t border-gray-100 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] text-gray-600 leading-snug">
                        Lock schedule (excluded from auto-reschedule; not
                        draggable)
                      </span>
                      <input
                        type="checkbox"
                        checked={item.isFixed}
                        onChange={(e) =>
                          onToggleOrderFixed(item.orderId, e.target.checked)
                        }
                        className="h-3.5 w-3.5 rounded border-gray-300 shrink-0"
                      />
                    </label>
                  )}
                {editMode &&
                  item.status === "SCHEDULED" &&
                  onToggleOrderPrioritized && (
                    <label
                      className="flex items-center justify-between gap-2 pt-1 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] text-amber-600 leading-snug inline-flex items-center gap-1">
                        <Crown className="h-3 w-3 shrink-0" aria-hidden />
                        Prioritize (scheduled first in auto-schedule)
                      </span>
                      <input
                        type="checkbox"
                        checked={item.isPrioritized}
                        onChange={(e) =>
                          onToggleOrderPrioritized(
                            item.orderId,
                            e.target.checked,
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-gray-300 shrink-0"
                      />
                    </label>
                  )}
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

      {/* Legacy SALES ETA strip — admin paths may pass myOrderIds without isSales */}
      {!isSales && myOrderItems.length > 0 && (
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
                    className={`text-[10px] font-semibold inline-flex items-center gap-1 ${isOverdue ? "text-red-500" : "text-green-600"}`}
                  >
                    {isOverdue ? (
                      <>
                        <AlertTriangle
                          className="h-3 w-3 shrink-0"
                          aria-hidden
                        />
                        At-risk
                      </>
                    ) : (
                      <>
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-green-500"
                          aria-hidden
                        />
                        On-track
                      </>
                    )}
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
// Pending orders sidebar (SALES: "My …"; ADMIN / SUPERADMIN: "Pending …")
// ---------------------------------------------------------------------------

function PendingSidebar({
  orders,
  today,
  onEditOrder,
  onCreate,
  selectedOrderIds,
  setSelectedOrderIds,
  onPreviewSelected,
  previewLoading = false,
  editMode = false,
  pendingPlaceOrderIds,
  isDragging = false,
  pendingSplitByOrderId,
  pendingSplitPlacements,
  onConfirmSplit,
  onUndoSplit,
  pendingOrdersTitle = "My Pending Orders",
  scheduleTypes,
  selectedScheduleType,
  onScheduleTypeChange,
}: {
  orders: PendingOrderInfo[];
  today: string;
  onEditOrder: (order: OrderEditorValues) => void;
  onCreate?: () => void;
  selectedOrderIds?: Set<string>;
  setSelectedOrderIds?: React.Dispatch<React.SetStateAction<Set<string>>>;
  onPreviewSelected?: (targetOrderIds: string[]) => void;
  previewLoading?: boolean;
  editMode?: boolean;
  pendingPlaceOrderIds?: Set<string>;
  isDragging?: boolean;
  pendingSplitByOrderId?: Map<string, PendingSplit>;
  pendingSplitPlacements?: Map<
    string,
    {
      orderId: string;
      factoryId: string;
      productionDate: string;
      quantity: number;
    }
  >;
  onConfirmSplit?: (orderId: string, parts: SplitPart[]) => void;
  onUndoSplit?: (orderId: string) => void;
  /** SALES: default "My Pending Orders"; ADMIN / SUPERADMIN: "Pending Orders". */
  pendingOrdersTitle?: string;
  /** SUPERADMIN: A/B/C tabs to filter pending + schedule target type. */
  scheduleTypes?: readonly string[];
  selectedScheduleType?: string;
  onScheduleTypeChange?: (type: string) => void;
}) {
  const multiSelectEnabled =
    !editMode && Boolean(setSelectedOrderIds && onPreviewSelected);
  const selected = selectedOrderIds ?? new Set<string>();
  const pending = orders
    .filter(
      (o) =>
        o.status === "PENDING" &&
        (!pendingPlaceOrderIds || !pendingPlaceOrderIds.has(o.id)),
    )
    .sort((a, b) => {
      if (a.isPrioritized !== b.isPrioritized) return a.isPrioritized ? -1 : 1;
      return 0;
    });
  const pendingIds = pending.map((o) => o.id);
  const allSelected =
    pendingIds.length > 0 && pendingIds.every((id) => selected.has(id));
  const someSelected =
    !allSelected && pendingIds.some((id) => selected.has(id));
  const selectedCount = selected.size;

  const [expandedSplitOrderId, setExpandedSplitOrderId] = useState<
    string | null
  >(null);
  const [draftSplitCount, setDraftSplitCount] = useState(2);
  const [draftParts, setDraftParts] = useState<
    { splitId: string; quantity: number }[]
  >([]);
  const [draftApplied, setDraftApplied] = useState(false);
  const draftTotal = draftParts.reduce((sum, p) => sum + p.quantity, 0);

  const applyDraft = (order: PendingOrderInfo) => {
    const count = Math.max(2, Math.min(10, draftSplitCount));
    const base = Math.floor(order.quantity / count);
    const remainder = order.quantity % count;
    const parts = Array.from({ length: count }, (_, i) => ({
      splitId: `split-${order.id}-${i}`,
      quantity: i === count - 1 ? base + remainder : base,
    }));
    setDraftParts(parts);
    setDraftApplied(true);
  };

  const confirmSplit = (orderId: string) => {
    if (!onConfirmSplit) return;
    onConfirmSplit(
      orderId,
      draftParts.map((p) => ({ splitId: p.splitId, quantity: p.quantity })),
    );
    setExpandedSplitOrderId(null);
    setDraftParts([]);
    setDraftApplied(false);
    setDraftSplitCount(2);
  };

  const toggleOne = (id: string) => {
    if (!setSelectedOrderIds) return;
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!setSelectedOrderIds) return;
    setSelectedOrderIds((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const id of pendingIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of pendingIds) next.add(id);
      return next;
    });
  };

  const riskDot = (risk: OrderRisk) => {
    if (risk === "OVERDUE")
      return (
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500"
          aria-hidden
        />
      );
    if (risk === "AT_RISK")
      return (
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full bg-orange-400"
          aria-hidden
        />
      );
    return (
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500"
        aria-hidden
      />
    );
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
    list.map((o) => {
      const card = (
        <div
          className={`bg-white rounded-lg p-3 text-xs space-y-1 shadow-sm ${borderColor(o.risk)}`}
        >
          <div className="flex items-start justify-between gap-1">
            {multiSelectEnabled ? (
              <label className="flex items-start gap-1.5 cursor-pointer flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggleOne(o.id)}
                  className="mt-0.5 h-3 w-3 shrink-0 cursor-pointer accent-indigo-600"
                  aria-label={`Select order ${o.name}`}
                />
                <span className="font-medium text-gray-900 leading-tight">
                  {o.name}
                </span>
              </label>
            ) : (
              <span className="font-medium text-gray-900 leading-tight flex-1 min-w-0">
                {o.name}
              </span>
            )}
            <div className="flex items-center gap-1 shrink-0">
              {o.isPrioritized && (
                <span title="Prioritized">
                  <Crown className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                </span>
              )}
              {riskDot(o.risk)}
            </div>
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
          {!editMode && (
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
                    isPrioritized: o.isPrioritized,
                  })
                }
                className="text-[10px] font-semibold px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              >
                Edit
              </button>
            </div>
          )}
          {editMode && !pendingSplitByOrderId?.has(o.id) && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedSplitOrderId(
                    expandedSplitOrderId === o.id ? null : o.id,
                  );
                  setDraftApplied(false);
                  setDraftSplitCount(2);
                  setDraftParts([]);
                }}
                className="text-[10px] font-semibold px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              >
                Split
              </button>
            </div>
          )}
        </div>
      );
      if (editMode && pendingSplitByOrderId?.has(o.id)) {
        const split = pendingSplitByOrderId.get(o.id)!;
        return (
          <div key={o.id} className="space-y-1.5">
            <div className="bg-gray-100 rounded-lg p-3 text-xs space-y-1 opacity-60 border-l-4 border-l-gray-300">
              <span className="font-medium text-gray-500">{o.name}</span>
              <div className="flex justify-between text-gray-400">
                <span>Qty</span>
                <span className="font-medium text-gray-500">
                  {o.quantity.toLocaleString()} (split ×{split.parts.length})
                </span>
              </div>
            </div>
            {split.parts.map((part, i) => {
              if (pendingSplitPlacements?.has(part.splitId)) return null;
              return (
                <DraggableSplitChip key={part.splitId} splitId={part.splitId}>
                  <div className="bg-white rounded border border-indigo-200 px-2 py-1.5 text-xs flex items-center justify-between gap-2 shadow-sm">
                    <span className="font-semibold text-indigo-700">
                      #{i + 1}
                    </span>
                    <span className="text-gray-700">
                      {part.quantity.toLocaleString()} · {o.dueDate}
                    </span>
                  </div>
                </DraggableSplitChip>
              );
            })}
            <button
              type="button"
              onClick={() => onUndoSplit?.(o.id)}
              className="w-full text-[10px] font-semibold px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            >
              Undo Split
            </button>
          </div>
        );
      }

      if (editMode && expandedSplitOrderId === o.id) {
        return (
          <div key={o.id} className="space-y-2">
            {card}
            <div className="bg-white rounded-lg border border-indigo-200 p-3 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Split into:</span>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={draftSplitCount}
                  onChange={(e) => {
                    setDraftSplitCount(Number(e.target.value));
                    setDraftApplied(false);
                  }}
                  className="w-14 border border-gray-200 rounded px-1.5 py-1 text-center"
                />
                <span className="text-gray-400">parts</span>
                <button
                  type="button"
                  onClick={() => applyDraft(o)}
                  className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 font-semibold hover:bg-indigo-100"
                >
                  Apply
                </button>
              </div>
              {draftApplied &&
                draftParts.map((part, i) => (
                  <div key={part.splitId} className="flex items-center gap-2">
                    <span className="text-gray-500 w-6">#{i + 1}</span>
                    <span className="text-gray-500">Qty:</span>
                    <input
                      type="number"
                      min={1}
                      value={part.quantity}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value) || 0);
                        setDraftParts((prev) =>
                          prev.map((p, j) =>
                            j === i ? { ...p, quantity: val } : p,
                          ),
                        );
                      }}
                      className="w-20 border border-gray-200 rounded px-1.5 py-1 text-center"
                    />
                  </div>
                ))}
              {draftApplied && (
                <>
                  <div
                    className={`text-right font-semibold ${
                      draftTotal === o.quantity
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    Total: {draftTotal} / {o.quantity}{" "}
                    {draftTotal === o.quantity ? (
                      <Check
                        className="inline h-3.5 w-3.5 text-green-600"
                        aria-hidden
                      />
                    ) : (
                      <X
                        className="inline h-3.5 w-3.5 text-red-600"
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedSplitOrderId(null);
                        setDraftApplied(false);
                      }}
                      className="text-[10px] font-semibold px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmSplit(o.id)}
                      disabled={draftTotal !== o.quantity}
                      className="text-[10px] font-semibold px-2 py-1 rounded border border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:border-gray-300"
                    >
                      Confirm Split
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      }

      return editMode ? (
        <DraggablePendingOrderCard key={o.id} orderId={o.id}>
          {card}
        </DraggablePendingOrderCard>
      ) : (
        <React.Fragment key={o.id}>{card}</React.Fragment>
      );
    });

  return (
    <div className="flex-none w-64 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">
              {pendingOrdersTitle}
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
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
              New Order
            </button>
          )}
        </div>
        {scheduleTypes &&
          scheduleTypes.length > 0 &&
          selectedScheduleType &&
          onScheduleTypeChange && (
            <div
              className="mt-2 flex gap-1"
              role="tablist"
              aria-label="Production type"
            >
              {scheduleTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === selectedScheduleType}
                  onClick={() => onScheduleTypeChange(t)}
                  className={`flex-1 rounded border px-2 py-1 text-[10px] font-semibold transition-colors ${
                    t === selectedScheduleType
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-300 hover:text-blue-700"
                  }`}
                >
                  Type {t}
                </button>
              ))}
            </div>
          )}
      </div>
      {multiSelectEnabled && pending.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-200 bg-white space-y-2">
          <button
            type="button"
            onClick={() => onPreviewSelected?.(Array.from(selected))}
            disabled={selectedCount === 0 || previewLoading}
            className={`w-full text-xs font-semibold px-2 py-1.5 rounded border transition-colors ${
              selectedCount === 0 || previewLoading
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {previewLoading ? (
              "Previewing…"
            ) : selectedCount === 0 ? (
              "Preview Selected"
            ) : (
              <span className="inline-flex items-center gap-1">
                <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {`Preview Selected (${selectedCount})`}
              </span>
            )}
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={toggleAll}
              className="h-3 w-3 cursor-pointer accent-indigo-600"
              aria-label="Select all pending orders"
            />
            <span className="font-medium">Select all ({pending.length})</span>
          </label>
        </div>
      )}
      <div
        className={`flex-1 overflow-x-hidden p-3 space-y-4 ${isDragging ? "overflow-y-hidden" : "overflow-y-auto"}`}
      >
        {orders.length === 0 && (
          <p className="text-xs text-gray-400 text-center pt-4">
            No pending orders
          </p>
        )}
        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              {pendingOrdersTitle}
            </p>
            {renderOrders(pending)}
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
  isPrioritized?: boolean;
};

function OrderFormModal({
  title,
  mode,
  initialValues,
  canEditPrioritized = false,
  today,
  onClose,
  onSubmit,
  onCsvImported,
}: {
  title: string;
  mode: "create" | "edit";
  initialValues: OrderEditorValues;
  canEditPrioritized?: boolean;
  today?: string;
  onClose: () => void;
  onSubmit: (values: OrderEditorValues) => Promise<void>;
  onCsvImported?: () => void;
}) {
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(initialValues.quantity);
  const [type, setType] = useState(initialValues.type ?? "A");
  const [dueDate, setDueDate] = useState(
    toDateInputValue(initialValues.dueDate) || "2026-12-31",
  );
  const [isPrioritized, setIsPrioritized] = useState(
    initialValues.isPrioritized ?? false,
  );
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isCreate = mode === "create";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (isCreate && csvFile) {
        const result = await importOrdersFromCsv(csvFile);
        if (result.successCount === 0) {
          throw new Error(
            result.errorList.join("\n") || "No orders were imported.",
          );
        }
        if (result.errorList.length > 0) {
          const preview = result.errorList.slice(0, 5).join("\n");
          const more =
            result.errorList.length > 5
              ? `\n…+${result.errorList.length - 5} more`
              : "";
          setError(
            `Imported ${result.successCount} order(s). Some rows failed:\n${preview}${more}`,
          );
          onCsvImported?.();
          setCsvFile(null);
          return;
        }
        onCsvImported?.();
        onClose();
        return;
      }

      await onSubmit({
        name: name.trim(),
        quantity: quantity.trim(),
        type: isCreate ? type.trim() : undefined,
        dueDate,
        orderId: initialValues.orderId,
        status: initialValues.status,
        isPrioritized,
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
                : "Update the order name, quantity, or due date and save the change."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
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

          <label className="block text-sm font-medium text-gray-700">
            Due Date
            <input
              type="date"
              value={dueDate}
              min={today}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

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

          {!isCreate && canEditPrioritized && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrioritized}
                onChange={(e) => setIsPrioritized(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 accent-amber-500"
              />
              <span className="text-sm font-medium text-gray-700 inline-flex items-center gap-1.5">
                <Crown
                  className="h-4 w-4 text-amber-600 shrink-0"
                  aria-hidden
                />
                Prioritize (scheduled first in auto-schedule)
              </span>
            </label>
          )}

          {isCreate && (
            <>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-wide">
                  <span className="bg-white px-2 text-gray-400">or</span>
                </div>
              </div>
              <OrderCsvDropZone
                file={csvFile}
                onFileChange={setCsvFile}
                disabled={submitting}
              />
            </>
          )}

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
              {submitting
                ? csvFile && isCreate
                  ? "Importing…"
                  : "Saving…"
                : mode === "create"
                  ? "Send"
                  : "Save"}
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
  hasNewlyPlaced,
  isMyOrder,
  isSales,
  detailClickable,
  editMode,
  movedAssignmentIds,
  dropDisabled = false,
  dropDisabledReason,
  columnHasInProduction = false,
  onToggleOrderFixed,
  onToggleOrderPrioritized,
  onClickItem,
  onClick,
}: {
  cell: CellData;
  hasRescheduled: boolean;
  hasNewlyPlaced: boolean;
  isMyOrder: boolean;
  isSales: boolean;
  /** SALES: false when the cell has no orders owned by the current user. */
  detailClickable: boolean;
  editMode: boolean;
  movedAssignmentIds: Set<string>;
  dropDisabled?: boolean;
  dropDisabledReason?: string;
  /** True when this column day has any IN_PRODUCTION assignment (column accent). */
  columnHasInProduction?: boolean;
  onToggleOrderFixed?: (orderId: string, next: boolean) => void;
  onToggleOrderPrioritized?: (orderId: string, next: boolean) => void;
  onClickItem?: (item: TimelineItem) => void;
  onClick: () => void;
}) {
  const { bg, barColor, fillRatio } = getCellStyle(cell);
  const hasConflict = cell.conflicts.length > 0;
  const pct = Math.round(fillRatio * 100);
  const cellId = `${cell.factoryId}|${cell.date}`;
  const fixedScheduledCount = cell.items.filter(
    (i) => i.status === "SCHEDULED" && i.isFixed,
  ).length;
  const prioritizedScheduledCount = cell.items.filter(
    (i) => i.status === "SCHEDULED" && i.isPrioritized,
  ).length;
  const totalCount = cell.items.length;
  const tdBorderClass = columnHasInProduction
    ? "border-2 border-emerald-500"
    : "border border-gray-100";

  // Edit-mode cell: shows draggable chips + drop target, no click handler.
  if (editMode) {
    return (
      <td className={`w-[72px] min-w-[72px] p-0 align-top ${tdBorderClass}`}>
        <DroppableCell
          cellId={cellId}
          className={`w-full min-h-14 relative ${bg}`}
          disabled={dropDisabled}
          invalidReason={dropDisabledReason}
        >
          {hasConflict && (
            <span className="absolute top-0.5 right-0.5 z-10 text-amber-600">
              <AlertTriangle
                className="h-2.5 w-2.5"
                strokeWidth={2.5}
                aria-hidden
              />
            </span>
          )}
          <div className="flex flex-col gap-0.5 p-0.5">
            {cell.items.map((item) => (
              <DraggableAssignmentChip
                key={item.assignmentId}
                item={item}
                isMoved={movedAssignmentIds.has(item.assignmentId)}
                editMode={editMode}
                onToggleOrderFixed={onToggleOrderFixed}
                onToggleOrderPrioritized={onToggleOrderPrioritized}
                onClickItem={onClickItem}
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
      <td className={`w-[72px] min-w-[72px] h-14 p-0 ${tdBorderClass}`}>
        <div className="w-full h-full bg-gray-50" />
      </td>
    );
  }

  const cellBodyClass = `w-full h-full flex flex-col items-center justify-end relative transition-all ${bg} group ${isSales && !isMyOrder ? "opacity-60" : ""} ${hasNewlyPlaced && !isMyOrder ? "ring-2 ring-inset ring-emerald-500" : ""} ${detailClickable ? "cursor-pointer hover:brightness-95" : "cursor-default"}`;

  const cellInner = (
    <>
      {/* Conflict marker */}
      {hasConflict && (
        <span className="absolute top-1 right-1 text-amber-600">
          <AlertTriangle
            className="h-2.5 w-2.5"
            strokeWidth={2.5}
            aria-hidden
          />
        </span>
      )}

      {/* Rescheduled marker */}
      {hasRescheduled && !hasConflict && (
        <span className="absolute top-1 right-1 text-purple-500">
          <ArrowDownUp className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
        </span>
      )}
      {hasRescheduled && hasConflict && (
        <span className="absolute top-1 right-4 text-purple-500">
          <ArrowDownUp className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
        </span>
      )}

      {/* Newly placed (preview) marker */}
      {hasNewlyPlaced && (
        <span
          className={`absolute ${hasRescheduled || hasConflict ? "top-1 right-7" : "top-1 right-1"} text-emerald-600`}
        >
          <Plus className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
        </span>
      )}

      {/* Assignment counts: total ×N (lock ×M, crown ×K) */}
      {cell.items.length > 0 && (
        <span
          className="absolute top-1 left-1 text-[9px] font-bold text-gray-500 inline-flex flex-wrap items-center gap-x-1 gap-y-0 max-w-[68px] leading-tight"
          title={`${totalCount} assignment(s)${fixedScheduledCount > 0 ? `, ${fixedScheduledCount} locked` : ""}${prioritizedScheduledCount > 0 ? `, ${prioritizedScheduledCount} prioritized` : ""}`}
        >
          <span>×{totalCount}</span>
          {(fixedScheduledCount > 0 || prioritizedScheduledCount > 0) && (
            <span className="inline-flex items-center gap-px">
              <span>(</span>
              {fixedScheduledCount > 0 && (
                <span className="text-gray-700 inline-flex items-center gap-px">
                  <Lock className="h-2 w-2" aria-hidden />
                  <span>×{fixedScheduledCount}</span>
                </span>
              )}
              {fixedScheduledCount > 0 && prioritizedScheduledCount > 0 && (
                <span className="mx-px"> </span>
              )}
              {prioritizedScheduledCount > 0 && (
                <span className="text-amber-600 inline-flex items-center gap-px">
                  <Crown className="h-2 w-2" aria-hidden />
                  <span>×{prioritizedScheduledCount}</span>
                </span>
              )}
              <span>)</span>
            </span>
          )}
          {isMyOrder && (
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
              title="Includes my order"
              aria-hidden
            />
          )}
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
    </>
  );

  return (
    <td className={`w-[72px] min-w-[72px] h-14 p-0 ${tdBorderClass}`}>
      {detailClickable ? (
        <button
          type="button"
          onClick={onClick}
          className={cellBodyClass}
          title={isMyOrder ? "View cell details" : undefined}
        >
          {cellInner}
        </button>
      ) : (
        <div
          className={cellBodyClass}
          title={isSales ? "This cell has no orders you own" : undefined}
        >
          {cellInner}
        </div>
      )}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type PendingSplit = {
  orderId: string;
  originalQuantity: number;
  parts: SplitPart[];
};

type SplitPart = {
  splitId: string;
  quantity: number;
};

type FetchError = { status: number; message: string };
type ScheduleStatus = "idle" | "running" | "success" | "conflict" | "error";

/** dnd-kit droppable id — must not contain `|` (grid cells use `factoryId|date`). */
const EDIT_STAGING_DROP_ID = "__VIS_EDIT_STAGING__";

type AssignmentMove =
  | {
      kind: "cell";
      factoryId: string;
      productionDate: string;
      original: { factoryId: string; productionDate: string };
    }
  | {
      kind: "staging";
      original: { factoryId: string; productionDate: string };
    };
type OrderEditorState = OrderEditorValues & { orderId?: string };

function NavLinks({
  pathname,
  isSuperAdmin,
}: {
  pathname: string;
  isSuperAdmin: boolean;
}) {
  const isVisDashboard = pathname.startsWith("/visualization/dashboard");
  const isVisualization = pathname.startsWith("/visualization");

  return (
    <>
      <Link
        href="/visualization"
        className={`text-sm font-medium px-3 py-2 ${
          isVisualization && !isVisDashboard
            ? "text-blue-700 border-b-2 border-blue-700"
            : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
        }`}
      >
        Schedule
      </Link>

      <Link
        href="/visualization/dashboard"
        className={`text-sm font-medium px-3 py-2 ${
          isVisDashboard
            ? "text-blue-700 border-b-2 border-blue-700"
            : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
        }`}
      >
        Dashboard
      </Link>

      <Link
        href="/conflict-issues"
        className={`text-sm font-medium px-3 py-2 ${
          pathname.startsWith("/conflict-issues")
            ? "text-blue-700 border-b-2 border-blue-700"
            : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
        }`}
      >
        Issues
      </Link>

      {isSuperAdmin && (
        <Link
          href="/permissions"
          className={`text-sm font-medium px-3 py-2 ${
            pathname.startsWith("/permissions")
              ? "text-blue-700 border-b-2 border-blue-700"
              : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
          }`}
        >
          Permissions
        </Link>
      )}

      <Link
        href="/profile"
        className={`text-sm font-medium px-3 py-2 ${
          pathname.startsWith("/profile")
            ? "text-blue-700 border-b-2 border-blue-700"
            : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
        }`}
      >
        Profile
      </Link>
    </>
  );
}

const SCHEDULE_PRODUCTION_TYPES = ["A", "B", "C"] as const;

export default function SchedulePage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const isSales = session?.user.role === "SALES";
  const isSuperAdmin = session?.user.role === "SUPERADMIN";
  const [selectedScheduleType, setSelectedScheduleType] = useState<
    string | null
  >(null);
  const activeScheduleType = isSuperAdmin
    ? (selectedScheduleType ?? session?.user.group ?? "A")
    : (session?.user.group ?? "");
  const pathname = usePathname();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<FetchError | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    factoryId: string;
    date: string;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus>("idle");

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
  // After a successful apply, if the preview contained FAILED orders, surface
  // a persistent banner so the user knows ConflictIssues were auto-created.
  const [applyConflictNotice, setApplyConflictNotice] = useState<{
    failedCount: number;
  } | null>(null);

  // Edit-mode state
  const [editMode, setEditMode] = useState(false);
  // Map<assignmentId, AssignmentMove>
  const [pendingMoves, setPendingMoves] = useState<Map<string, AssignmentMove>>(
    () => new Map(),
  );
  /** Pending order-level `isFixed` overrides while in edit mode (key = orderId). */
  const [pendingIsFixedByOrderId, setPendingIsFixedByOrderId] = useState<
    Map<string, boolean>
  >(() => new Map());
  /** Pending order-level `isPrioritized` overrides while in edit mode (key = orderId). */
  const [pendingIsPrioritizedByOrderId, setPendingIsPrioritizedByOrderId] =
    useState<Map<string, boolean>>(() => new Map());
  const [draggingAssignment, setDraggingAssignment] =
    useState<TimelineItem | null>(null);
  const [pendingPlaceByOrderId, setPendingPlaceByOrderId] = useState<
    Map<string, { factoryId: string; productionDate: string }>
  >(() => new Map());
  const [pendingSplitByOrderId, setPendingSplitByOrderId] = useState<
    Map<string, PendingSplit>
  >(() => new Map());
  const [pendingSplitPlacements, setPendingSplitPlacements] = useState<
    Map<
      string,
      {
        orderId: string;
        factoryId: string;
        productionDate: string;
        quantity: number;
      }
    >
  >(() => new Map());
  const [draggingSplitOrderId, setDraggingSplitOrderId] = useState<
    string | null
  >(null);
  const [draggingPendingOrder, setDraggingPendingOrder] =
    useState<PendingOrderInfo | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  // Simulation mode state (from dev)
  const [simMode, setSimMode] = useState(false);
  const [simDate, setSimDate] = useState("");
  const [simDateTime, setSimDateTime] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  /** Last simulation calendar day from server; used to realign range only when it changes. */
  const serverSimCalendarDayRef = useRef<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderEditorState | null>(null);

  // T4A: multi-select pending orders for targeted preview.
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );

  const handleScheduleTypeChange = useCallback((type: string) => {
    setSelectedScheduleType(type);
    setSelectedOrderIds(new Set());
    setPreviewData(null);
    setPreviewId(null);
    setPreviewError(null);
  }, []);

  // Fetch timeline data
  useEffect(() => {
    if (session === null) {
      router.replace("/login");
      return;
    }
    if (session === undefined) return;
    if (!startDate || !endDate) return;

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
          const payload = (await r.json()) as TimelineResponse;
          setData(payload);
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
    if (!activeScheduleType) return;
    const policy = algorithmOverride ?? reschedulePolicy;
    setScheduleStatus("running");
    try {
      const baseConfig: Record<string, unknown> = {
        reschedulePolicy: policy,
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };

      const res = await fetch("/api/schedule/run", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: activeScheduleType, config: baseConfig }),
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

  const handlePreviewSchedule = async (targetOrderIds?: string[]) => {
    if (!activeScheduleType) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const baseConfig: Record<string, unknown> = {
        reschedulePolicy,
        frozenDays: 0,
        productionDays: 1,
        bufferDays: 0,
        algorithm: "GREEDY_BEST_FIT",
        splittable: true,
      };
      if (targetOrderIds && targetOrderIds.length > 0) {
        baseConfig.targetOrderIds = targetOrderIds;
      }
      const res = await fetch("/api/schedule/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeScheduleType,
          config: baseConfig,
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
    } catch {
      setPreviewError("Network error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyPreview = async () => {
    if (!previewId) {
      setPreviewError("No preview to apply — run Preview first.");
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
        setPreviewError(body?.message ?? "Data changed — re-run Preview.");
        setPreviewData(null);
        setPreviewId(null);
        return;
      }

      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        setPreviewError(body?.message ?? "Preview expired — re-run Preview.");
        setPreviewData(null);
        setPreviewId(null);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPreviewError(body?.message ?? "Apply failed");
        setScheduleStatus("error");
        setTimeout(() => setScheduleStatus("idle"), 4000);
        return;
      }

      // Success — capture FAILED count from the preview before clearing it,
      // so we can surface a persistent notice pointing the user to issues.
      const failedCount = previewData?.unscheduledOrders.length ?? 0;
      setPreviewData(null);
      setPreviewId(null);
      setSelectedOrderIds(new Set());
      setScheduleStatus("success");
      setTimeout(() => setScheduleStatus("idle"), 4000);
      if (failedCount > 0) {
        setApplyConflictNotice({ failedCount });
      }
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
    setPendingIsFixedByOrderId(new Map());
    setPendingIsPrioritizedByOrderId(new Map());
    setPendingPlaceByOrderId(new Map());
    setPendingSplitByOrderId(new Map());
    setPendingSplitPlacements(new Map());
    setDraggingPendingOrder(null);
    setSaveStatus("idle");
    setSelectedCell(null);
    setPreviewData(null);
    setPreviewId(null);
  };

  const handleDiscardEdits = () => {
    setEditMode(false);
    setPendingMoves(new Map());
    setPendingIsFixedByOrderId(new Map());
    setPendingIsPrioritizedByOrderId(new Map());
    setPendingPlaceByOrderId(new Map());
    setPendingSplitByOrderId(new Map());
    setPendingSplitPlacements(new Map());
    setDraggingPendingOrder(null);
    setSaveStatus("idle");
  };

  const handleToggleOrderFixed = useCallback(
    (orderId: string, next: boolean) => {
      if (!data) return;
      const baseline =
        data.timeline.find((t) => t.orderId === orderId)?.isFixed ?? false;
      setPendingIsFixedByOrderId((prev) => {
        const n = new Map(prev);
        if (next === baseline) n.delete(orderId);
        else n.set(orderId, next);
        return n;
      });
    },
    [data],
  );

  const handleToggleOrderPrioritized = useCallback(
    (orderId: string, next: boolean) => {
      if (!data) return;
      const baseline =
        data.timeline.find((t) => t.orderId === orderId)?.isPrioritized ??
        false;
      setPendingIsPrioritizedByOrderId((prev) => {
        const n = new Map(prev);
        if (next === baseline) n.delete(orderId);
        else n.set(orderId, next);
        return n;
      });
    },
    [data],
  );

  const handleConfirmSplit = useCallback(
    (orderId: string, parts: SplitPart[]) => {
      const order = data?.adminContext?.pendingOrders.find(
        (o) => o.id === orderId,
      );
      if (!order) return;
      setPendingSplitByOrderId((prev) => {
        const next = new Map(prev);
        next.set(orderId, { orderId, originalQuantity: order.quantity, parts });
        return next;
      });
    },
    [data],
  );

  const handleUndoSplit = useCallback((orderId: string) => {
    setPendingSplitByOrderId((prev) => {
      const next = new Map(prev);
      next.delete(orderId);
      return next;
    });
    setPendingSplitPlacements((prev) => {
      const next = new Map(prev);
      for (const [splitId, p] of prev) {
        if (p.orderId === orderId) next.delete(splitId);
      }
      return next;
    });
  }, []);

  const handleSaveEdits = async () => {
    if (!data) return;

    const cellMoveEntries = Array.from(pendingMoves.entries()).filter(
      (e): e is [string, Extract<AssignmentMove, { kind: "cell" }>] =>
        e[1].kind === "cell",
    );

    const hasStaging = Array.from(pendingMoves.values()).some(
      (m) => m.kind === "staging",
    );
    if (hasStaging) {
      setSaveStatus("error");
      setSaveErrorMsg(
        "Assignments remain in staging — drag them back onto a factory/date cell before saving, or Discard to revert.",
      );
      setTimeout(() => setSaveStatus("idle"), 6000);
      return;
    }

    // Validate all split parts are placed
    for (const [orderId, split] of pendingSplitByOrderId) {
      const placedSplitIds = new Set(
        Array.from(pendingSplitPlacements.entries())
          .filter(([, p]) => p.orderId === orderId)
          .map(([splitId]) => splitId),
      );
      const unplaced = split.parts.filter(
        (p) => !placedSplitIds.has(p.splitId),
      );
      if (unplaced.length > 0) {
        setSaveStatus("error");
        setSaveErrorMsg(
          `Order "${data?.adminContext?.pendingOrders.find((o) => o.id === orderId)?.name ?? orderId}" has ${unplaced.length} unplaced split part(s). Place all parts or undo the split.`,
        );
        setTimeout(() => setSaveStatus("idle"), 6000);
        return;
      }
    }

    if (
      cellMoveEntries.length === 0 &&
      pendingIsFixedByOrderId.size === 0 &&
      pendingIsPrioritizedByOrderId.size === 0 &&
      pendingPlaceByOrderId.size === 0 &&
      pendingSplitPlacements.size === 0
    ) {
      setEditMode(false);
      return;
    }

    setSaveStatus("saving");
    setSaveErrorMsg(null);

    const baselineFixed = (orderId: string) =>
      data.timeline.find((t) => t.orderId === orderId)?.isFixed ?? false;
    const baselinePrioritized = (orderId: string) =>
      data.timeline.find((t) => t.orderId === orderId)?.isPrioritized ?? false;

    const toUnlock: string[] = [];
    const toLock: string[] = [];
    for (const [orderId, next] of pendingIsFixedByOrderId) {
      if (next === false && baselineFixed(orderId)) toUnlock.push(orderId);
      else if (next === true && !baselineFixed(orderId)) toLock.push(orderId);
    }

    const toPrioritize: string[] = [];
    const toUnprioritize: string[] = [];
    for (const [orderId, next] of pendingIsPrioritizedByOrderId) {
      if (next === true && !baselinePrioritized(orderId))
        toPrioritize.push(orderId);
      else if (next === false && baselinePrioritized(orderId))
        toUnprioritize.push(orderId);
    }

    try {
      let movePartialWarning: string | null = null;

      for (const id of toUnlock) {
        const res = await fetch(`/api/orders/${id}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFixed: false }),
        });
        const unlockBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSaveStatus("error");
          setSaveErrorMsg(
            unlockBody.message ?? `Failed to unlock (${res.status})`,
          );
          setTimeout(() => setSaveStatus("idle"), 6000);
          return;
        }
      }

      const pendingPlaceEntries = Array.from(pendingPlaceByOrderId.entries());
      const splitPlaceEntries = Array.from(pendingSplitPlacements.entries());
      if (
        cellMoveEntries.length > 0 ||
        pendingPlaceEntries.length > 0 ||
        splitPlaceEntries.length > 0
      ) {
        const moves = [
          ...cellMoveEntries.map(([id, m]) => ({
            assignmentId: id,
            factoryId: m.factoryId,
            productionDate: m.productionDate,
          })),
          ...pendingPlaceEntries.map(([orderId, place]) => ({
            orderId,
            factoryId: place.factoryId,
            productionDate: place.productionDate,
          })),
          ...splitPlaceEntries.map(([, place]) => ({
            orderId: place.orderId,
            factoryId: place.factoryId,
            productionDate: place.productionDate,
            quantity: place.quantity,
          })),
        ];
        const res = await fetch("/api/assignments/bulk", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moves }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSaveStatus("error");
          const violations: { reason: string }[] = Array.isArray(
            body.violations,
          )
            ? body.violations
            : [];
          const detail =
            violations.length > 0
              ? violations.map((v) => v.reason).join("; ")
              : (body.message ?? `HTTP ${res.status}`);
          setSaveErrorMsg(`Save failed: ${detail}`);
          setTimeout(() => setSaveStatus("idle"), 6000);
          return;
        }
        const applied = typeof body.applied === "number" ? body.applied : 0;
        const errors: { assignmentId: string; reason: string }[] =
          Array.isArray(body.errors) ? body.errors : [];
        if (applied === 0 && errors.length > 0) {
          setSaveStatus("error");
          setSaveErrorMsg(
            `0 / ${moves.length} moves saved. ${errors[0].reason}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`,
          );
          setTimeout(() => setSaveStatus("idle"), 6000);
          return;
        }
        if (errors.length > 0) {
          movePartialWarning = `${applied} saved, ${errors.length} rejected: ${errors[0].reason}`;
        }
      }

      for (const id of toLock) {
        const res = await fetch(`/api/orders/${id}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isFixed: true }),
        });
        const lockBody = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSaveStatus("error");
          setSaveErrorMsg(lockBody.message ?? `Failed to lock (${res.status})`);
          setTimeout(() => setSaveStatus("idle"), 6000);
          return;
        }
      }

      for (const id of [...toPrioritize, ...toUnprioritize]) {
        const next = toPrioritize.includes(id);
        const res = await fetch(`/api/orders/${id}`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPrioritized: next }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSaveStatus("error");
          setSaveErrorMsg(
            body.message ?? `Failed to update priority (${res.status})`,
          );
          setTimeout(() => setSaveStatus("idle"), 6000);
          return;
        }
      }

      setSaveStatus("success");
      setSaveErrorMsg(movePartialWarning);
      setEditMode(false);
      setPendingMoves(new Map());
      setPendingIsFixedByOrderId(new Map());
      setPendingIsPrioritizedByOrderId(new Map());
      setPendingPlaceByOrderId(new Map());
      setPendingSplitByOrderId(new Map());
      setPendingSplitPlacements(new Map());
      setDraggingPendingOrder(null);
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
    const activeId = String(event.active.id);

    if (activeId.startsWith("pending-order:")) {
      const orderId = activeId.slice("pending-order:".length);
      const order = data?.adminContext?.pendingOrders.find(
        (o) => o.id === orderId,
      );
      if (order) {
        setDraggingPendingOrder(order);
        setDraggingSplitOrderId(null);
        setDraggingAssignment(null);
      }
      return;
    }

    if (activeId.startsWith("pending-split:")) {
      const splitId = activeId.slice("pending-split:".length);
      for (const [orderId, split] of pendingSplitByOrderId) {
        const part = split.parts.find((p) => p.splitId === splitId);
        if (part) {
          const order = data?.adminContext?.pendingOrders.find(
            (o) => o.id === orderId,
          );
          if (order) {
            setDraggingPendingOrder({ ...order, quantity: part.quantity });
            setDraggingSplitOrderId(orderId);
            setDraggingAssignment(null);
          }
          break;
        }
      }
      return;
    }

    setDraggingPendingOrder(null);
    setDraggingSplitOrderId(null);
    const assignmentId = activeId;
    const baseTimeline = data?.timeline ?? [];
    const item = baseTimeline.find((t) => t.assignmentId === assignmentId);
    if (!item) return;
    const effectiveFixed =
      pendingIsFixedByOrderId.get(item.orderId) ?? item.isFixed;
    if (item.status !== "SCHEDULED" || effectiveFixed) return;
    setDraggingAssignment(item);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingAssignment(null);
    setDraggingPendingOrder(null);
    setDraggingSplitOrderId(null);
    if (!event.over) return;

    const activeId = String(event.active.id);
    const overId = String(event.over.id);

    if (activeId.startsWith("pending-order:")) {
      const orderId = activeId.slice("pending-order:".length);
      if (overId === EDIT_STAGING_DROP_ID) return;
      const [factoryId, date] = overId.split("|");
      if (!factoryId || !date) return;
      setPendingPlaceByOrderId((prev) => {
        const next = new Map(prev);
        next.set(orderId, { factoryId, productionDate: date });
        return next;
      });
      return;
    }

    if (activeId.startsWith("pending-split:")) {
      const splitId = activeId.slice("pending-split:".length);
      if (overId === EDIT_STAGING_DROP_ID) return;
      const [factoryId, date] = overId.split("|");
      if (!factoryId || !date) return;
      let splitOrderId = "";
      let splitQty = 0;
      for (const [orderId, split] of pendingSplitByOrderId) {
        const part = split.parts.find((p) => p.splitId === splitId);
        if (part) {
          splitOrderId = orderId;
          splitQty = part.quantity;
          break;
        }
      }
      if (!splitOrderId) return;
      setPendingSplitPlacements((prev) => {
        const next = new Map(prev);
        next.set(splitId, {
          orderId: splitOrderId,
          factoryId,
          productionDate: date,
          quantity: splitQty,
        });
        return next;
      });
      return;
    }

    const assignmentId = activeId;
    const item = data?.timeline.find((t) => t.assignmentId === assignmentId);
    if (!item) return;

    const effectiveFixed =
      pendingIsFixedByOrderId.get(item.orderId) ?? item.isFixed;

    if (overId === EDIT_STAGING_DROP_ID) {
      if (item.status !== "SCHEDULED" || effectiveFixed) return;
      setPendingMoves((prev) => {
        if (prev.get(assignmentId)?.kind === "staging") return prev;
        const next = new Map(prev);
        next.set(assignmentId, {
          kind: "staging",
          original: {
            factoryId: item.factoryId,
            productionDate: item.productionDate,
          },
        });
        return next;
      });
      return;
    }

    const [factoryId, date] = overId.split("|");
    if (!factoryId || !date) return;

    const current = pendingMoves.get(assignmentId);
    const currFactory =
      current?.kind === "cell"
        ? current.factoryId
        : current?.kind === "staging"
          ? null
          : item.factoryId;
    const currDate =
      current?.kind === "cell"
        ? current.productionDate
        : current?.kind === "staging"
          ? null
          : item.productionDate;
    if (
      currFactory !== null &&
      currDate !== null &&
      currFactory === factoryId &&
      currDate === date
    ) {
      return;
    }

    setPendingMoves((prev) => {
      const next = new Map(prev);
      // If dropping back to original, remove the pending move
      if (factoryId === item.factoryId && date === item.productionDate) {
        next.delete(assignmentId);
      } else {
        next.set(assignmentId, {
          kind: "cell",
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

    if (
      editMode &&
      (pendingMoves.size > 0 ||
        pendingPlaceByOrderId.size > 0 ||
        pendingSplitPlacements.size > 0)
    ) {
      const movedTimeline: TimelineItem[] = [];
      for (const t of data.timeline) {
        const move = pendingMoves.get(t.assignmentId);
        if (move?.kind === "staging") continue;
        if (!move) {
          movedTimeline.push(t);
          continue;
        }
        movedTimeline.push({
          ...t,
          factoryId: move.factoryId,
          productionDate: move.productionDate,
        });
      }
      for (const [orderId, place] of pendingPlaceByOrderId) {
        const order = data.adminContext?.pendingOrders.find(
          (o) => o.id === orderId,
        );
        if (!order) continue;
        movedTimeline.push({
          assignmentId: `__pending-place-${orderId}`,
          orderId,
          orderName: order.name,
          factoryId: place.factoryId,
          productionDate: place.productionDate,
          dueDate: order.dueDate,
          assignedQuantity: order.quantity,
          status: "SCHEDULED",
          isFixed: false,
          isPrioritized: order.isPrioritized,
        } as TimelineItem);
      }
      for (const [splitId, place] of pendingSplitPlacements) {
        const order = data.adminContext?.pendingOrders.find(
          (o) => o.id === place.orderId,
        );
        if (!order) continue;
        movedTimeline.push({
          assignmentId: `__pending-split-${splitId}`,
          orderId: place.orderId,
          orderName: order.name,
          factoryId: place.factoryId,
          productionDate: place.productionDate,
          dueDate: order.dueDate,
          assignedQuantity: place.quantity,
          status: "SCHEDULED",
          isFixed: false,
          isPrioritized: order.isPrioritized,
        } as TimelineItem);
      }
      const timelineWithFixed = applyPendingIsPrioritizedByOrder(
        applyPendingIsFixedByOrder(movedTimeline, pendingIsFixedByOrderId),
        pendingIsPrioritizedByOrderId,
      );
      // Recompute daily capacities from moved timeline
      const usedByCell = new Map<string, number>();
      for (const t of timelineWithFixed) {
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
          const affected = timelineWithFixed
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
      for (const t of timelineWithFixed) {
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
        timeline: timelineWithFixed,
        dailyCapacities: Array.from(dailyCapMap.values()),
        conflicts,
        diffs: data.diffs,
      };
    }

    if (
      editMode &&
      (pendingIsFixedByOrderId.size > 0 ||
        pendingIsPrioritizedByOrderId.size > 0)
    ) {
      return {
        factories: data.factories,
        timeline: applyPendingIsPrioritizedByOrder(
          applyPendingIsFixedByOrder(data.timeline, pendingIsFixedByOrderId),
          pendingIsPrioritizedByOrderId,
        ),
        dailyCapacities: data.dailyCapacities,
        conflicts: data.conflicts,
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
  }, [
    data,
    previewData,
    editMode,
    pendingMoves,
    pendingIsFixedByOrderId,
    pendingIsPrioritizedByOrderId,
    pendingPlaceByOrderId,
    pendingSplitPlacements,
  ]);
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
        dueDate: `${values.dueDate}T00:00:00.000Z`,
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

    if (values.dueDate) {
      body.dueDate = new Date(values.dueDate).toISOString();
    }
    if (values.isPrioritized !== undefined && !isSales) {
      body.isPrioritized = values.isPrioritized;
    }

    if (Object.keys(body).length === 0) {
      throw new Error("Name, quantity, or due date is required.");
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

  // Load simulation state on mount and seed the timeline range (10-day default from anchor) before the first fetch.
  useEffect(() => {
    if (!session) return;
    fetch("/api/system/simulation", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((body) => {
        setSimMode(!!body.isSimulationMode);
        if (body.simulationDate) {
          setSimDate(body.simulationDate.split("T")[0]);
          setSimDateTime(body.simulationDate);
        }
        const anchor =
          body.isSimulationMode && body.simulationDate
            ? String(body.simulationDate).split("T")[0]
            : format(new Date(), "yyyy-MM-dd");
        const range = defaultTimelineRange(anchor);
        setStartDate(range.startDate);
        setEndDate(range.endDate);
        serverSimCalendarDayRef.current =
          body.isSimulationMode && body.simulationDate
            ? String(body.simulationDate).split("T")[0]
            : null;
      })
      .catch(() => {
        const range = defaultTimelineRange(format(new Date(), "yyyy-MM-dd"));
        setStartDate(range.startDate);
        setEndDate(range.endDate);
        serverSimCalendarDayRef.current = null;
      });
  }, [session]);

  // Auto-refresh every 60 s while in Real-time mode
  useEffect(() => {
    if (simMode) return;
    const id = setInterval(() => {
      setRefreshKey((k) => k + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, [simMode]);

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
          setSimDate(body.simulationDate.split("T")[0]);
          setSimDateTime(body.simulationDate);
        } else {
          setSimDate("");
          setSimDateTime("");
        }
        const nextSimDay =
          body.isSimulationMode && body.simulationDate
            ? String(body.simulationDate).split("T")[0]
            : null;
        const prevSimDay = serverSimCalendarDayRef.current;
        if (nextSimDay && nextSimDay !== prevSimDay) {
          const range = defaultTimelineRange(nextSimDay);
          setStartDate(range.startDate);
          setEndDate(range.endDate);
        }
        serverSimCalendarDayRef.current = nextSimDay;

        setLoading(true);
        setFetchError(null);
        setRefreshKey((k) => k + 1);
      }
    } finally {
      setSimLoading(false);
    }
  };

  const handleTimeModeChange = (nextIsManual: boolean) => {
    setSimMode(nextIsManual); // optimistic update — confirmed by patchSim response
    if (!nextIsManual) {
      patchSim({ isSimulationMode: false });
      // Snap the date window back to today-2
      const range = defaultTimelineRange(format(new Date(), "yyyy-MM-dd"));
      setStartDate(range.startDate);
      setEndDate(range.endDate);
      return;
    }

    // Always start simulation from the current real date, not a stale previous sim date
    patchSim({
      isSimulationMode: true,
      simulationDate: dateInputToIso(
        data?.today ?? format(new Date(), "yyyy-MM-dd"),
      ),
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
    const baseStr =
      simDateTime || data?.today || format(new Date(), "yyyy-MM-dd");
    const base = new Date(
      baseStr.includes("T") ? baseStr : `${baseStr}T00:00:00.000Z`,
    );
    base.setUTCDate(base.getUTCDate() + days);
    base.setUTCHours(0, 0, 0, 0);
    const nextIso = base.toISOString();
    setSimDateTime(nextIso);
    setSimDate(nextIso.split("T")[0]);
    patchSim({ simulationDate: nextIso });
  };

  const stepSimHours = (hours: number) => {
    const baseStr =
      simDateTime || data?.today || format(new Date(), "yyyy-MM-dd");
    const base = new Date(
      baseStr.includes("T") ? baseStr : `${baseStr}T00:00:00.000Z`,
    );
    base.setUTCHours(base.getUTCHours() + hours);
    const nextIso = base.toISOString();
    setSimDateTime(nextIso);
    setSimDate(nextIso.split("T")[0]);
    patchSim({ simulationDate: nextIso });
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

  /** Calendar days where the effective timeline has any IN_PRODUCTION assignment. */
  const datesWithInProduction = useMemo(() => {
    const set = new Set<string>();
    for (const t of effective?.timeline ?? []) {
      if (t.status === "IN_PRODUCTION") set.add(t.productionDate);
    }
    return set;
  }, [effective?.timeline]);

  // Group factories by productionType (A/B/C only; excludes integration-test types)
  const groups = useMemo(() => {
    if (!effective) return [];
    const map = new Map<string, FactoryInfo[]>();
    for (const f of effective.factories) {
      if (
        !SCHEDULE_PRODUCTION_TYPES.includes(
          f.productionType as (typeof SCHEDULE_PRODUCTION_TYPES)[number],
        )
      ) {
        continue;
      }
      const existing = map.get(f.productionType) ?? [];
      map.set(f.productionType, [...existing, f]);
    }
    return SCHEDULE_PRODUCTION_TYPES.filter((t) => map.has(t)).map(
      (type) => [type, map.get(type)!] as const,
    );
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

  // Per-cell: does it contain any rescheduled order (was already scheduled,
  // moved to a different date)?
  const rescheduledCells = useMemo(() => {
    const set = new Set<string>();
    for (const item of effective?.timeline ?? []) {
      const d = diffByOrderId.get(item.orderId);
      if (d && d.before !== "") {
        set.add(`${item.factoryId}__${item.productionDate}`);
      }
    }
    return set;
  }, [effective, diffByOrderId]);

  // Per-cell: does it contain any newly placed order (had no previous schedule,
  // first placed by this preview)? Used for the preview "newly added" highlight.
  const newlyPlacedCells = useMemo(() => {
    const set = new Set<string>();
    for (const item of effective?.timeline ?? []) {
      const d = diffByOrderId.get(item.orderId);
      if (d && d.before === "") {
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

  const hasPendingStaging = useMemo(
    () => Array.from(pendingMoves.values()).some((m) => m.kind === "staging"),
    [pendingMoves],
  );

  const pendingEditCount = useMemo(
    () =>
      pendingMoves.size +
      pendingIsFixedByOrderId.size +
      pendingIsPrioritizedByOrderId.size +
      pendingPlaceByOrderId.size +
      pendingSplitPlacements.size,
    [
      pendingMoves,
      pendingIsFixedByOrderId,
      pendingIsPrioritizedByOrderId,
      pendingPlaceByOrderId,
      pendingSplitPlacements,
    ],
  );

  /** Timeline rows held in the edit-mode staging strip (off the Gantt grid). */
  const stagedAssignmentItems = useMemo(() => {
    if (!data) return [] as TimelineItem[];
    const items: TimelineItem[] = [];
    for (const [id, m] of pendingMoves) {
      if (m.kind !== "staging") continue;
      const t = data.timeline.find((x) => x.assignmentId === id);
      if (t) {
        const pFixed = pendingIsFixedByOrderId.get(t.orderId);
        const pPrio = pendingIsPrioritizedByOrderId.get(t.orderId);
        let merged = t;
        if (pFixed !== undefined && pFixed !== t.isFixed)
          merged = { ...merged, isFixed: pFixed };
        if (pPrio !== undefined && pPrio !== t.isPrioritized)
          merged = { ...merged, isPrioritized: pPrio };
        items.push(merged);
      }
    }
    return items;
  }, [
    data,
    pendingMoves,
    pendingIsFixedByOrderId,
    pendingIsPrioritizedByOrderId,
  ]);

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
      <div className="flex-none bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="w-80 flex-shrink-0 overflow-hidden">
            <h1 className="text-xl font-bold text-gray-900 truncate">
              Production Schedule
            </h1>
            <p className="text-sm text-gray-500 mt-1 truncate">
              Factory gantt — click a cell to inspect orders
            </p>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <nav
              className="flex items-center gap-2 flex-wrap"
              aria-label="Dashboard navigation"
            >
              {/* determine active link */}
              {/* path-aware checks */}
              {/* We'll compute pathname inside component render below */}
              <NavLinks
                pathname={pathname ?? ""}
                isSuperAdmin={session?.user.role === "SUPERADMIN"}
              />
            </nav>
          </div>

          <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1 bg-gray-50">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
              Signed in as:
            </span>
            <span className="text-xs font-semibold text-gray-800">
              {session.user.username}
            </span>
            <span className="text-xs text-gray-500">
              ({session.user.email})
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
              {session.user.role}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs font-medium px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-2 text-xs">
          {capacityConflicts > 0 && (
            <span className="flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 rounded px-2 py-1 font-medium">
              <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {capacityConflicts} capacity
            </span>
          )}
          {dueDateConflicts > 0 && (
            <span className="flex items-center gap-1 bg-orange-50 text-orange-700 border border-orange-200 rounded px-2 py-1 font-medium">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {dueDateConflicts} due date
            </span>
          )}
          {rescheduledCount > 0 && (
            <span className="flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-200 rounded px-2 py-1 font-medium">
              <ArrowDownUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {rescheduledCount} rescheduled
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
            disabled={simLoading}
            className={`px-2.5 py-1 font-semibold transition-colors ${
              !simMode
                ? "bg-green-600 text-white"
                : "text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            }`}
          >
            Real-time
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
            Custom
          </button>
        </div>
        {simMode && (
          <>
            <button
              type="button"
              onClick={() => stepSimDate(1)}
              disabled={simLoading}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
            >
              +1 day
            </button>
            <button
              type="button"
              onClick={() => stepSimHours(2)}
              disabled={simLoading}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium ml-1"
            >
              +2 hours
            </button>
            <span className="inline-flex items-center gap-1.5 text-amber-700 font-semibold bg-amber-100 border border-amber-200 rounded px-2 py-0.5">
              Custom:
              <input
                type="date"
                value={simDate}
                onChange={handleSimDateChange}
                disabled={simLoading}
                className="bg-transparent border-none outline-none text-amber-700 font-semibold cursor-pointer"
              />
              {simDateTime && <span>{simDateTime.substring(11, 16)}</span>}
            </span>
          </>
        )}
        {!simMode && (
          <span className="inline-flex items-center gap-1.5 text-green-700 font-semibold bg-green-50 border border-green-200 rounded px-2 py-0.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-green-600"
              aria-hidden
            />
            Real-time
          </span>
        )}
      </div>

      {/* Date range + schedule controls */}
      <div className="flex-none px-6 py-3 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
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

          {!isSales && (
            <div className="flex items-center gap-2 flex-wrap">
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
                  <option value="GAP_FILLING">Gap filling (GAP_FILLING)</option>
                  <option value="PRIORITY_RETAIN">
                    Retain priority placement (PRIORITY_RETAIN)
                  </option>
                  <option value="GLOBAL_OPTIMIZE">
                    Global optimize (GLOBAL_OPTIMIZE)
                  </option>
                </select>
              </label>

              <button
                type="button"
                onClick={() => handlePreviewSchedule()}
                disabled={
                  previewLoading || editMode || scheduleStatus === "running"
                }
                className={`text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
                  previewLoading || editMode
                    ? "bg-gray-100 text-gray-600 border-gray-200 cursor-not-allowed"
                    : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50"
                }`}
              >
                {previewLoading ? (
                  "Previewing…"
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Preview
                  </span>
                )}
              </button>

              <button
                type="button"
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
                {scheduleStatus === "running" ? (
                  "Running…"
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {`Run (Type ${activeScheduleType || "-"})`}
                  </span>
                )}
              </button>

              {!editMode && !previewData && (
                <button
                  type="button"
                  onClick={handleEnterEditMode}
                  className="text-xs font-medium px-3 py-1.5 rounded border bg-white text-purple-700 border-purple-300 hover:bg-purple-50"
                >
                  <span className="inline-flex items-center gap-1">
                    <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Edit
                  </span>
                </button>
              )}

              {scheduleStatus === "success" && (
                <span className="text-xs text-green-600 font-medium inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Scheduled
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
                <span className="text-xs text-green-600 font-medium inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {saveErrorMsg ? `Saved (${saveErrorMsg})` : "Saved"}
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
        </div>
      </div>

      {/* Preview banner */}
      {previewData && (
        <div className="flex-none px-6 py-2 bg-indigo-50 border-b border-indigo-200 flex items-center gap-3">
          <span className="text-xs font-semibold text-indigo-700 shrink-0 inline-flex items-center gap-1">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Preview · {previewData.algorithm}
          </span>
          <span className="text-xs text-indigo-700">
            {previewData.diffs.length} order(s) would be rescheduled
            {previewData.unscheduledOrders.length > 0 &&
              `, ${previewData.unscheduledOrders.length} cannot fit`}
            .
            {selectedOrderIds.size > 0 && (
              <span className="ml-2 font-medium">
                Targeted {selectedOrderIds.size} order
                {selectedOrderIds.size === 1 ? "" : "s"}.
              </span>
            )}
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
              {applying ? (
                "Applying…"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Apply
                </span>
              )}
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
            type="button"
            onClick={() => setPreviewError(null)}
            className="ml-2 inline-flex rounded p-0.5 text-red-500 hover:bg-red-100 hover:text-red-700"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Edit-mode banner */}
      {editMode && (
        <div className="flex-none px-6 py-2 bg-purple-50 border-b border-purple-200 flex items-center gap-3">
          <span className="text-xs font-semibold text-purple-700 shrink-0 inline-flex items-center gap-1">
            <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Edit mode
          </span>
          <span className="text-xs text-purple-700">
            Drag chips between cells, or into the staging area below to pull an
            assignment off the grid. Use the checkbox on each chip to lock the
            order (no auto-reschedule / no drag).{" "}
            <span className="font-semibold">{pendingEditCount}</span> pending
            change(s).
            {hasPendingStaging && (
              <span className="ml-1 font-semibold text-amber-800">
                (staging: cannot save until moved back)
              </span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleSaveEdits}
              disabled={saveStatus === "saving" || hasPendingStaging}
              title={
                hasPendingStaging
                  ? "Clear the staging area by dragging assignments back onto the grid before saving."
                  : undefined
              }
              className="text-xs font-medium px-3 py-1.5 rounded border bg-purple-600 text-white border-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:border-gray-300"
            >
              {saveStatus === "saving" ? (
                "Saving…"
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Save className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Save Changes
                </span>
              )}
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

      {/* Preview-driven FAILED hint — auto-issue + email fires on apply */}
      {previewData && previewData.unscheduledOrders.length > 0 && (
        <div className="flex-none px-6 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800">
          {previewData.unscheduledOrders.length} order(s) cannot be scheduled —
          applying will automatically open conflict issues.
        </div>
      )}

      {/* Post-apply conflict notice — persistent until dismissed */}
      {applyConflictNotice && (
        <div className="flex-none px-6 py-2 bg-amber-100 border-b border-amber-300 flex items-center justify-between gap-3 text-xs text-amber-900">
          <span className="inline-flex items-start gap-2">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-amber-700 mt-0.5"
              aria-hidden
            />
            <span>
              Schedule applied, but {applyConflictNotice.failedCount} order(s)
              could not be placed. ConflictIssue records were created
              automatically. Open the{" "}
              <Link
                href="/conflict-issues"
                className="font-semibold underline hover:text-amber-700"
              >
                order issues
              </Link>{" "}
              page to review and resolve.
            </span>
          </span>
          <button
            type="button"
            onClick={() => setApplyConflictNotice(null)}
            className="font-semibold px-2 py-0.5 rounded border border-amber-300 bg-white hover:bg-amber-50"
            aria-label="Dismiss"
          >
            Dismiss
          </button>
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
          <AlertTriangle
            className="h-3 w-3 shrink-0 text-amber-600"
            aria-hidden
          />
          Conflict
        </span>
        <span className="flex items-center gap-1.5">
          <ArrowDownUp
            className="h-3 w-3 shrink-0 text-purple-500"
            aria-hidden
          />
          Rescheduled
        </span>
        <span className="flex items-center gap-1.5">
          <Plus className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden />
          Newly placed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-500">×N</span> Order
          count
        </span>
        <span className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 shrink-0 text-gray-600" aria-hidden />
          Fixed
        </span>
        <span className="flex items-center gap-1.5">
          <Crown className="h-3 w-3 shrink-0 text-amber-600" aria-hidden />
          Prioritized
        </span>
      </div>

      {/* Gantt body */}
      <div className="flex-1 overflow-hidden flex">
        {!loading && !fetchError && data ? (
          <DndContext
            sensors={sensors}
            onDragStart={editMode ? handleDragStart : undefined}
            onDragEnd={
              editMode ? handleDragEnd : () => setDraggingAssignment(null)
            }
          >
            {isSales && data.salesContext && (
              <PendingSidebar
                orders={data.salesContext.pendingOrders}
                today={data.today}
                onEditOrder={(order) => setEditOrder(order)}
                onCreate={() => setCreateOpen(true)}
              />
            )}
            {!isSales && data.adminContext && (
              <PendingSidebar
                orders={
                  isSuperAdmin
                    ? data.adminContext.pendingOrders.filter(
                        (o) => o.type === activeScheduleType,
                      )
                    : data.adminContext.pendingOrders
                }
                today={data.today}
                onEditOrder={(order) => setEditOrder(order)}
                pendingOrdersTitle="Pending Orders"
                selectedOrderIds={selectedOrderIds}
                setSelectedOrderIds={setSelectedOrderIds}
                onPreviewSelected={(targetOrderIds) =>
                  handlePreviewSchedule(targetOrderIds)
                }
                previewLoading={previewLoading}
                editMode={editMode}
                pendingPlaceOrderIds={new Set(pendingPlaceByOrderId.keys())}
                isDragging={
                  draggingPendingOrder !== null || draggingAssignment !== null
                }
                pendingSplitByOrderId={pendingSplitByOrderId}
                pendingSplitPlacements={pendingSplitPlacements}
                onConfirmSplit={handleConfirmSplit}
                onUndoSplit={handleUndoSplit}
                scheduleTypes={
                  isSuperAdmin ? SCHEDULE_PRODUCTION_TYPES : undefined
                }
                selectedScheduleType={
                  isSuperAdmin ? activeScheduleType : undefined
                }
                onScheduleTypeChange={
                  isSuperAdmin ? handleScheduleTypeChange : undefined
                }
              />
            )}
            <div className="flex-1 overflow-auto">
              {editMode && (
                <div className="px-4 py-2 border-b border-amber-200 bg-amber-50/90">
                  <div className="text-[11px] font-semibold text-amber-950">
                    Staging
                  </div>
                  <p className="text-[10px] text-amber-900/85 mt-0.5 mb-2 leading-snug">
                    Drag movable assignments here to pull them off the Gantt
                    (freeing capacity on the original cell), then drop them on a
                    target factory/date. You cannot save while staging has items
                    — move them back to the grid or press Discard.
                  </p>
                  <DroppableCell
                    cellId={EDIT_STAGING_DROP_ID}
                    className="min-h-[52px] rounded-lg border-2 border-dashed border-amber-400 bg-white p-2 flex flex-wrap gap-1 items-start content-start"
                  >
                    {stagedAssignmentItems.length === 0 ? (
                      <span className="text-[10px] text-amber-700/80 italic py-1">
                        Drop assignments here…
                      </span>
                    ) : (
                      stagedAssignmentItems.map((st) => (
                        <DraggableAssignmentChip
                          key={st.assignmentId}
                          item={st}
                          isMoved={movedAssignmentIds.has(st.assignmentId)}
                          editMode={editMode}
                          onToggleOrderFixed={handleToggleOrderFixed}
                          onToggleOrderPrioritized={
                            handleToggleOrderPrioritized
                          }
                        />
                      ))
                    )}
                  </DroppableCell>
                </div>
              )}
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
                      const inProdDay = datesWithInProduction.has(d);
                      return (
                        <th
                          key={d}
                          className={`sticky top-0 z-20 w-[72px] min-w-[72px] px-1 py-2 text-center font-medium ${
                            inProdDay
                              ? "border-2 border-emerald-500 bg-emerald-50/95 text-emerald-950"
                              : `border border-gray-200 ${
                                  isWeekend
                                    ? "bg-gray-50 text-gray-400"
                                    : "bg-white text-gray-600"
                                }`
                          }`}
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
                            const detailClickable = !isSales || isMyOrder;

                            // Edit-mode drop validation: block drops that would
                            // overflow the cell's maxCapacity or push the
                            // assignment past its dueDate. Dropping back to the
                            // dragging chip's current cell is always allowed
                            // (it's a no-op).
                            let dropDisabled = false;
                            let dropDisabledReason: string | undefined;
                            if (editMode && draggingAssignment) {
                              const pending = pendingMoves.get(
                                draggingAssignment.assignmentId,
                              );
                              const currFactoryId =
                                pending?.kind === "cell"
                                  ? pending.factoryId
                                  : pending?.kind === "staging"
                                    ? null
                                    : draggingAssignment.factoryId;
                              const currDate =
                                pending?.kind === "cell"
                                  ? pending.productionDate
                                  : pending?.kind === "staging"
                                    ? null
                                    : draggingAssignment.productionDate;
                              const isCurrentCell =
                                currFactoryId !== null &&
                                currDate !== null &&
                                factory.id === currFactoryId &&
                                date === currDate;
                              if (!isCurrentCell) {
                                if (date >= draggingAssignment.dueDate) {
                                  dropDisabled = true;
                                  dropDisabledReason = `On or after due date ${draggingAssignment.dueDate} (needs production time)`;
                                } else if (
                                  cell.usedCapacity +
                                    draggingAssignment.assignedQuantity >
                                  cell.maxCapacity
                                ) {
                                  const remaining = Math.max(
                                    0,
                                    cell.maxCapacity - cell.usedCapacity,
                                  );
                                  dropDisabled = true;
                                  dropDisabledReason = `Insufficient capacity (remaining ${remaining.toLocaleString()} / need ${draggingAssignment.assignedQuantity.toLocaleString()})`;
                                }
                              }
                            }
                            if (editMode && draggingPendingOrder) {
                              if (date >= draggingPendingOrder.dueDate) {
                                dropDisabled = true;
                                dropDisabledReason = `On or after due date ${draggingPendingOrder.dueDate} (needs production time)`;
                              } else if (
                                cell.usedCapacity +
                                  draggingPendingOrder.quantity >
                                cell.maxCapacity
                              ) {
                                const remaining = Math.max(
                                  0,
                                  cell.maxCapacity - cell.usedCapacity,
                                );
                                dropDisabled = true;
                                dropDisabledReason = `Insufficient capacity (remaining ${remaining.toLocaleString()} / need ${draggingPendingOrder.quantity.toLocaleString()})`;
                              }
                              if (!dropDisabled && draggingSplitOrderId) {
                                const sameOrderInCell = Array.from(
                                  pendingSplitPlacements.entries(),
                                ).some(
                                  ([, p]) =>
                                    p.orderId === draggingSplitOrderId &&
                                    p.factoryId === factory.id &&
                                    p.productionDate === date,
                                );
                                if (sameOrderInCell) {
                                  dropDisabled = true;
                                  dropDisabledReason =
                                    "Same order's split parts must be placed in different cells";
                                }
                              }
                            }

                            return (
                              <GanttCell
                                key={key}
                                cell={cell}
                                hasRescheduled={rescheduledCells.has(key)}
                                hasNewlyPlaced={newlyPlacedCells.has(key)}
                                isMyOrder={isMyOrder}
                                isSales={isSales}
                                detailClickable={detailClickable}
                                editMode={editMode}
                                movedAssignmentIds={movedAssignmentIds}
                                dropDisabled={dropDisabled}
                                dropDisabledReason={dropDisabledReason}
                                columnHasInProduction={datesWithInProduction.has(
                                  date,
                                )}
                                onToggleOrderFixed={handleToggleOrderFixed}
                                onToggleOrderPrioritized={
                                  handleToggleOrderPrioritized
                                }
                                onClickItem={
                                  editMode
                                    ? (item) =>
                                        setEditOrder({
                                          orderId: item.orderId,
                                          name: item.orderName,
                                          quantity: String(
                                            item.assignedQuantity,
                                          ),
                                          status: item.status,
                                          dueDate: item.dueDate,
                                          isPrioritized: item.isPrioritized,
                                        })
                                    : undefined
                                }
                                onClick={() => {
                                  if (!detailClickable) return;
                                  setSelectedCell({
                                    factoryId: factory.id,
                                    date,
                                  });
                                }}
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
                {draggingPendingOrder && (
                  <div className="text-[9px] leading-tight rounded px-1 py-0.5 bg-indigo-100 border border-indigo-400 text-indigo-800 shadow-lg">
                    <span className="font-semibold truncate block max-w-[80px]">
                      {draggingPendingOrder.name}
                    </span>
                    <span className="text-[8px] opacity-70">
                      ×{draggingPendingOrder.quantity}
                    </span>
                  </div>
                )}
              </DragOverlay>
            </div>
          </DndContext>
        ) : (
          <div className="flex-1 overflow-auto">
            {loading && (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Loading…
              </div>
            )}
            {!loading && fetchError && (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <span className="text-2xl text-gray-500">
                  {fetchError.status === 403 ? (
                    <Lock
                      className="h-8 w-8 mx-auto"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ) : (
                    <AlertTriangle
                      className="h-8 w-8 mx-auto text-amber-500"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  )}
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
          </div>
        )}
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
            editMode={editMode}
            isSales={isSales}
            onEditOrder={(order) => setEditOrder(order)}
            onToggleOrderFixed={handleToggleOrderFixed}
            onToggleOrderPrioritized={handleToggleOrderPrioritized}
            onClose={() => setSelectedCell(null)}
          />
        </>
      )}

      {createOpen && (
        <OrderFormModal
          title="Create Order"
          mode="create"
          initialValues={{
            name: "",
            quantity: "",
            type: "A",
            dueDate: "2026-12-31",
          }}
          today={data?.today}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreateOrder}
          onCsvImported={() => {
            setCreateOpen(false);
            setLoading(true);
            setFetchError(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {editOrder && (
        <OrderFormModal
          key={editOrder.orderId ?? "edit"}
          title="Update Order"
          mode="edit"
          initialValues={{
            name: editOrder.name,
            quantity: editOrder.quantity,
            orderId: editOrder.orderId,
            status: editOrder.status,
            dueDate: editOrder.dueDate,
            type: editOrder.type,
            isPrioritized: editOrder.isPrioritized,
          }}
          canEditPrioritized={!isSales}
          today={data?.today}
          onClose={() => setEditOrder(null)}
          onSubmit={handleUpdateOrder}
        />
      )}
    </div>
  );
}
