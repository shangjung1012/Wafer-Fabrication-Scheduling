"use client";

import React from "react";

type SummaryConflict = {
  factoryId: string;
  date: string;
  conflictType: string;
  severity: string;
  message: string;
};

type StatusCounts = {
  PENDING?: number;
  APPROVED?: number;
  SCHEDULED?: number;
  IN_PRODUCTION?: number;
  COMPLETED?: number;
  CANCELLED?: number;
};

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "indigo" | "green" | "gray";
}) {
  const toneClasses: Record<typeof tone, string> = {
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
    green: "bg-green-50 border-green-200 text-green-700",
    gray: "bg-gray-50 border-gray-200 text-gray-700",
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
  conflicts,
  statusCounts = {},
}: {
  conflicts: SummaryConflict[];
  statusCounts?: StatusCounts;
}) {
  const hasConflicts = conflicts.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Top: Conflict status */}
      <div className="flex items-center">
        {!hasConflicts ? (
          <div className="flex items-center gap-2 text-green-600">
            <span className="text-2xl">●</span>
            <span className="text-lg font-medium">正常 (Normal)</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-red-600">
            <span className="text-2xl animate-pulse">⚠️</span>
            <span className="text-lg font-bold">
              衝突發生 (Conflicts Detected)
            </span>
            <span className="text-sm opacity-80 ml-2">
              ({conflicts.length} conflict{conflicts.length > 1 ? "s" : ""})
            </span>
          </div>
        )}
      </div>

      {/* Bottom: Status counts in grid */}
      <div className="grid grid-cols-4 gap-3">
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
