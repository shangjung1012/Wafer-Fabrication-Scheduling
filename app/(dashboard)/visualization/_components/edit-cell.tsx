"use client";

import React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { TimelineItem } from "@/modules/visualization/types";

/** Visual tone for assignment chips on the Gantt (edit mode). */
function assignmentChipToneClasses(
  status: TimelineItem["status"],
  isMoved: boolean,
): string {
  if (status === "SCHEDULED") {
    return isMoved
      ? "bg-purple-100 border-purple-300 text-purple-800"
      : "bg-white/90 border-gray-300 text-gray-700 hover:border-blue-400 hover:bg-blue-50";
  }
  if (status === "IN_PRODUCTION") {
    return "bg-emerald-100 border-emerald-500 text-emerald-950";
  }
  if (status === "COMPLETED") {
    return "grayscale bg-neutral-100 border-neutral-300 text-neutral-600";
  }
  return "bg-rose-50 border-rose-200 text-rose-800";
}

export function DraggableAssignmentChip({
  item,
  isMoved,
}: {
  item: TimelineItem;
  isMoved: boolean;
}) {
  const isLocked = item.status !== "SCHEDULED";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.assignmentId, disabled: isLocked });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
  };

  if (isLocked) {
    return (
      <div
        className={`text-[9px] leading-tight rounded px-1 py-0.5 select-none border cursor-not-allowed ${assignmentChipToneClasses(item.status, false)}`}
        title={`${item.orderName} · qty ${item.assignedQuantity} · ${item.status} (locked)`}
      >
        <span className="font-semibold truncate block max-w-[64px]">
          🔒 {item.orderName}
        </span>
        <span className="text-[8px] opacity-70">
          ×{item.assignedQuantity} · {item.status}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`text-[9px] leading-tight rounded px-1 py-0.5 cursor-grab active:cursor-grabbing select-none border ${assignmentChipToneClasses(item.status, isMoved)}`}
      title={`${item.orderName} · qty ${item.assignedQuantity}`}
    >
      <span className="font-semibold truncate block max-w-[64px]">
        {item.orderName}
      </span>
      <span className="text-[8px] opacity-70">×{item.assignedQuantity}</span>
    </div>
  );
}

export function DroppableCell({
  cellId,
  children,
  className,
  disabled = false,
  invalidReason,
}: {
  cellId: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  invalidReason?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId, disabled });
  return (
    <div
      ref={setNodeRef}
      title={disabled ? invalidReason : undefined}
      className={`${className ?? ""} ${
        disabled
          ? "opacity-40 cursor-not-allowed ring-2 ring-inset ring-red-200"
          : isOver
            ? "ring-2 ring-blue-500 ring-inset bg-blue-100/40"
            : ""
      }`}
    >
      {children}
    </div>
  );
}
