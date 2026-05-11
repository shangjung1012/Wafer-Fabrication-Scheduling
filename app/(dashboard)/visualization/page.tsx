"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format, eachDayOfInterval, parseISO } from "date-fns";
import type {
  TimelineResponse,
  TimelineItem,
  ConflictInfo,
  DiffEntry,
  FactoryInfo,
} from "@/modules/visualization/types";
import { logoutClientAuthSession } from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

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
  onClose,
}: {
  cell: CellData;
  factory: FactoryInfo;
  diffByOrderId: Map<string, DiffEntry>;
  onClose: () => void;
}) {
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gantt cell
// ---------------------------------------------------------------------------

function GanttCell({
  cell,
  hasRescheduled,
  onClick,
}: {
  cell: CellData;
  hasRescheduled: boolean;
  onClick: () => void;
}) {
  const { bg, barColor, fillRatio } = getCellStyle(cell);
  const hasConflict = cell.conflicts.length > 0;
  const pct = Math.round(fillRatio * 100);

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
        className={`w-full h-full flex flex-col items-center justify-end relative cursor-pointer hover:brightness-95 transition-all ${bg} group`}
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

export default function SchedulePage() {
  const router = useRouter();
  const session = useClientAuthSession();
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

  // Run schedule handler
  const handleRunSchedule = async () => {
    if (!productionType) return;
    setScheduleStatus("running");
    try {
      const res = await fetch("/api/schedule/run", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: productionType }),
      });
      if (res.status === 409) {
        setScheduleStatus("conflict");
      } else if (res.ok) {
        setScheduleStatus("success");
        setLoading(true);
        setFetchError(null);
        setRefreshKey((k) => k + 1);
      } else {
        setScheduleStatus("error");
      }
    } catch {
      setScheduleStatus("error");
    }
    setTimeout(() => setScheduleStatus("idle"), 4000);
  };

  const handleLogout = async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  };

  // Build date columns
  const dates = useMemo(() => {
    if (!startDate || !endDate) return [];
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (end < start) return [];
    return eachDayOfInterval({ start, end }).map((d) => toDateStr(d));
  }, [startDate, endDate]);

  // Cell map
  const cellMap = useMemo(
    () => (data ? buildCellMap(data, dates) : new Map()),
    [data, dates],
  );

  // Group factories by productionType
  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, FactoryInfo[]>();
    for (const f of data.factories) {
      const existing = map.get(f.productionType) ?? [];
      map.set(f.productionType, [...existing, f]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  // Diff lookup: orderId → DiffEntry
  const diffByOrderId = useMemo(() => {
    const map = new Map<string, DiffEntry>();
    for (const d of data?.diffs ?? []) {
      map.set(d.orderId, d);
    }
    return map;
  }, [data]);

  // Per-cell: does it contain any rescheduled order?
  const rescheduledCells = useMemo(() => {
    const set = new Set<string>();
    for (const item of data?.timeline ?? []) {
      if (diffByOrderId.has(item.orderId)) {
        set.add(`${item.factoryId}__${item.productionDate}`);
      }
    }
    return set;
  }, [data, diffByOrderId]);

  // Selected cell detail
  const selectedCellData = useMemo(() => {
    if (!selectedCell || !data) return null;
    const key = `${selectedCell.factoryId}__${selectedCell.date}`;
    return cellMap.get(key) ?? null;
  }, [selectedCell, cellMap, data]);

  const selectedFactory = useMemo(() => {
    if (!selectedCell || !data) return null;
    return data.factories.find((f) => f.id === selectedCell.factoryId) ?? null;
  }, [selectedCell, data]);

  // Summary counts
  const capacityConflicts =
    data?.conflicts.filter((c) => c.conflictType === "CAPACITY").length ?? 0;
  const dueDateConflicts =
    data?.conflicts.filter((c) => c.conflictType === "DUE_DATE").length ?? 0;
  const rescheduledCount = data?.diffs.length ?? 0;

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

        <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1 bg-gray-50">
          <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
            Signed in as:
          </span>
          <span className="text-xs font-semibold text-gray-800">
            {session.user.name}
          </span>
          <span className="text-xs text-gray-500">
            ({session.user.accountId})
          </span>
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

        {/* Run Schedule */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunSchedule}
            disabled={scheduleStatus === "running"}
            className={`text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
              scheduleStatus === "running"
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                : "bg-green-600 text-white border-green-600 hover:bg-green-700"
            }`}
          >
            {scheduleStatus === "running"
              ? "Running…"
              : `▶ Run Schedule (Type ${productionType || "-"})`}
          </button>
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
        </div>

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
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
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
                        return (
                          <GanttCell
                            key={key}
                            cell={cell}
                            hasRescheduled={rescheduledCells.has(key)}
                            onClick={() =>
                              setSelectedCell({ factoryId: factory.id, date })
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
            onClose={() => setSelectedCell(null)}
          />
        </>
      )}
    </div>
  );
}
