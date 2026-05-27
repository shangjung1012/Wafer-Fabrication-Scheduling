"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

type StatusCounts = {
  PENDING?: number;
  SCHEDULED?: number;
  IN_PRODUCTION?: number;
  COMPLETED?: number;
  CANCELLED?: number;
  /** Orders that could not be scheduled (OrderStatus.FAILED). */
  FAILED?: number;
};

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "indigo" | "green" | "gray" | "rose";
}) {
  const toneClasses: Record<typeof tone, string> = {
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
    green: "bg-green-50 border-green-200 text-green-700",
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    rose: "bg-rose-50 border-rose-200 text-rose-800",
  };

  return (
    <div
      className={`rounded-lg border px-4 py-3 shadow-sm flex flex-col items-center justify-center ${toneClasses[tone]}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold leading-none">{value}</div>
    </div>
  );
}

export function DashboardSummary({
  statusCounts = {},
}: {
  statusCounts?: StatusCounts;
}) {
  const n = statusCounts.FAILED ?? 0;
  const hasFailed = n > 0;

  const failHeadline =
    n === 0 ? "Normal" : n === 1 ? "1 failed order" : `${n} failed orders`;

  const failSubline =
    n === 0
      ? "No orders are in FAILED status (schedule could not place them)."
      : "FAILED means the order could not be fully scheduled. Review issues or adjust capacity and re-run scheduling.";

  const severityWrap =
    n === 0
      ? "text-green-600"
      : n >= 8
        ? "text-red-700"
        : n >= 3
          ? "text-orange-700"
          : "text-amber-700";

  return (
    <div className="flex flex-col gap-4">
      {/* Top: FAILED order status — copy and tone follow FAILED count */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        {!hasFailed ? (
          <div className={`flex items-center gap-2 ${severityWrap}`}>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-current"
              aria-hidden
            />
            <div className="flex flex-col">
              <span className="text-lg font-semibold leading-tight">
                {failHeadline}
              </span>
              <span className="text-xs text-gray-500 font-normal">
                {failSubline}
              </span>
            </div>
          </div>
        ) : (
          <div className={`flex items-start gap-2 ${severityWrap}`}>
            <AlertTriangle
              className="h-5 w-5 shrink-0 mt-0.5"
              aria-hidden
              strokeWidth={2.25}
            />
            <div className="flex flex-col min-w-0">
              <span className="text-lg font-bold leading-tight">
                {failHeadline}
              </span>
              <span className="text-sm opacity-90 font-medium leading-snug">
                {failSubline}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom: Status counts in grid — Conflict = FAILED orders */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <StatusCard
          label="Conflict"
          value={n}
          tone={hasFailed ? "rose" : "gray"}
        />
        <StatusCard
          label="Pending"
          value={statusCounts.PENDING ?? 0}
          tone="amber"
        />
        <StatusCard
          label="Scheduled"
          value={statusCounts.SCHEDULED ?? 0}
          tone="indigo"
        />
        <StatusCard
          label="In Production"
          value={statusCounts.IN_PRODUCTION ?? 0}
          tone="green"
        />
        <StatusCard
          label="Completed"
          value={statusCounts.COMPLETED ?? 0}
          tone="gray"
        />
      </div>
    </div>
  );
}
