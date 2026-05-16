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
  AlgorithmInfo,
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
  onClose,
}: {
  cell: CellData;
  factory: FactoryInfo;
  diffByOrderId: Map<string, DiffEntry>;
  myOrderIds?: string[];
  etaByOrderId?: Map<string, string>;
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
                <StatusBadge status={item.status} />
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

function PendingSidebar({ orders }: { orders: PendingOrderInfo[] }) {
  const today = toDateStr(new Date());
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
      </div>
    ));

  return (
    <div className="flex-none w-64 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-white">
        <p className="text-xs font-semibold text-gray-700">My Pending Orders</p>
        <p className="text-[10px] text-gray-400">{orders.length} unscheduled</p>
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

  // Algorithm selector + preview state
  const [algorithms, setAlgorithms] = useState<AlgorithmInfo[]>([]);
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<string>("greedy-best-fit");
  const [previewData, setPreviewData] =
    useState<SchedulePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  // Fetch algorithm list (admin/superadmin only)
  useEffect(() => {
    if (!session || session.user.role === "SALES") return;
    fetch("/api/schedule/algorithms", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.algorithms) setAlgorithms(body.algorithms);
      })
      .catch(() => {});
  }, [session]);

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
    const algorithm = algorithmOverride ?? selectedAlgorithm;
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
        const body = await res.json().catch(() => ({}));
        setEmailsAutoSent(body.emailsSent === true);
        if (Array.isArray(body.conflicts) && body.conflicts.length > 0) {
          setScheduleConflicts(body.conflicts);
          setScheduleStatus("idle");
        } else {
          setScheduleStatus("success");
          setTimeout(() => setScheduleStatus("idle"), 4000);
        }
        setLoading(true);
        setFetchError(null);
        setPreviewData(null);
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
          algorithm: selectedAlgorithm,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPreviewError(body.message ?? `HTTP ${res.status}`);
        return;
      }
      const body: SchedulePreviewResponse = await res.json();
      setPreviewData(body);
    } catch {
      setPreviewError("Network error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyPreview = async () => {
    if (!previewData) return;
    await handleRunSchedule(previewData.algorithm);
    setPreviewData(null);
  };

  const handleDiscardPreview = () => {
    setPreviewData(null);
    setPreviewError(null);
  };

  // Edit-mode handlers
  const handleEnterEditMode = () => {
    setEditMode(true);
    setPendingMoves(new Map());
    setSaveStatus("idle");
    setSelectedCell(null);
    setPreviewData(null);
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

  // Manual notify handler (preview mode)
  const handleSendNotifications = async () => {
    if (scheduleConflicts.length === 0) return;
    setNotifyStatus("sending");
    try {
      const res = await fetch("/api/schedule/notify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: scheduleConflicts }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const failedCount = Array.isArray(body.failed) ? body.failed.length : 0;
        const sentCount = Array.isArray(body.sent) ? body.sent.length : 0;
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
            },
            dates,
          )
        : new Map(),
    [effective, dates, data?.salesContext],
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
            {/* Algorithm dropdown */}
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <span className="text-gray-500">Algorithm</span>
              <select
                value={selectedAlgorithm}
                onChange={(e) => setSelectedAlgorithm(e.target.value)}
                disabled={editMode || previewLoading}
                className="text-xs border border-gray-200 rounded px-2 py-1 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                title={
                  algorithms.find((a) => a.id === selectedAlgorithm)
                    ?.description ?? ""
                }
              >
                {algorithms.length === 0 && (
                  <option value="greedy-best-fit">Greedy Best-Fit</option>
                )}
                {algorithms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
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
              disabled={scheduleStatus === "running"}
              className="text-xs font-medium px-3 py-1.5 rounded border bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:border-gray-300"
            >
              ✓ Apply
            </button>
            <button
              onClick={handleDiscardPreview}
              className="text-xs font-medium px-3 py-1.5 rounded border bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
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
                Notification emails sent for {scheduleConflicts.length} order(s)
                that could not be scheduled.
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
                    disabled={notifyStatus === "sending"}
                    className={`px-2.5 py-1 rounded border font-medium transition-colors ${
                      notifyStatus === "sending"
                        ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                        : "bg-amber-700 text-white border-amber-700 hover:bg-amber-800"
                    }`}
                  >
                    {notifyStatus === "sending"
                      ? "Sending…"
                      : "Send notifications"}
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
          <PendingSidebar orders={data.salesContext.pendingOrders} />
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
            onClose={() => setSelectedCell(null)}
          />
        </>
      )}
    </div>
  );
}
