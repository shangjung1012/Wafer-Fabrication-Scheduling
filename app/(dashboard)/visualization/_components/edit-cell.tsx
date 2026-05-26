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
  editMode = false,
  onToggleOrderFixed,
  onClickItem,
}: {
  item: TimelineItem;
  isMoved: boolean;
  editMode?: boolean;
  onToggleOrderFixed?: (orderId: string, next: boolean) => void;
  onClickItem?: (item: TimelineItem) => void;
}) {
  const isLockedByStatus = item.status !== "SCHEDULED";
  const isFixed = item.isFixed;
  const dragDisabled = isLockedByStatus || isFixed;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: item.assignmentId,
      disabled: dragDisabled,
    });

  const style: React.CSSProperties = dragDisabled
    ? {}
    : {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.3 : 1,
      };

  const showFixedToggle =
    editMode && item.status === "SCHEDULED" && onToggleOrderFixed;

  if (isLockedByStatus) {
    return (
      <div
        onClick={onClickItem ? () => onClickItem(item) : undefined}
        className={`text-[9px] leading-tight rounded px-1 py-0.5 select-none border ${onClickItem ? "cursor-pointer" : "cursor-not-allowed"} ${assignmentChipToneClasses(item.status, false)}`}
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

  const tone = assignmentChipToneClasses(item.status, isMoved);
  const cursorClass = dragDisabled
    ? isFixed && showFixedToggle
      ? "cursor-default"
      : "cursor-not-allowed"
    : "cursor-grab active:cursor-grabbing";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(dragDisabled ? {} : { ...listeners, ...attributes })}
      onClick={onClickItem && !isDragging ? () => onClickItem(item) : undefined}
      className={`text-[9px] leading-tight rounded px-1 py-0.5 select-none border ${cursorClass} ${tone}`}
      title={
        isFixed
          ? `${item.orderName} · qty ${item.assignedQuantity} · locked (fixed)`
          : `${item.orderName} · qty ${item.assignedQuantity}`
      }
    >
      <span className="font-semibold truncate block max-w-[64px]">
        {isFixed ? "🔒 " : ""}
        {item.orderName}
      </span>
      <span className="text-[8px] opacity-70 block">
        ×{item.assignedQuantity}
        {isFixed ? " · SCHEDULED" : null}
      </span>
      {showFixedToggle && (
        <label
          className="mt-0.5 flex items-center gap-0.5 pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isFixed}
            onChange={(e) => onToggleOrderFixed(item.orderId, e.target.checked)}
            className="h-2.5 w-2.5 rounded border-gray-400 shrink-0"
          />
          <span className="text-[7px] text-gray-700 leading-none">Lock</span>
        </label>
      )}
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

export function DraggableSplitChip({
  splitId,
  children,
}: {
  splitId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `pending-split:${splitId}` });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}

export function DraggablePendingOrderCard({
  orderId,
  children,
}: {
  orderId: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: `pending-order:${orderId}` });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab active:cursor-grabbing"
    >
      {children}
    </div>
  );
}
