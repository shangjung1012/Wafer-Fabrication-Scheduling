"use client";

import React, { useCallback, useId, useRef, useState } from "react";
import { Upload } from "lucide-react";

function isCsvFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".csv") || file.type === "text/csv";
}

export function OrderCsvDropZone({
  file,
  onFileChange,
  disabled = false,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pickError, setPickError] = useState("");

  const applyFile = useCallback(
    (next: File | null) => {
      if (next && !isCsvFile(next)) {
        setPickError("Please choose a .csv file.");
        return;
      }
      setPickError("");
      onFileChange(next);
    },
    [onFileChange],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) applyFile(dropped);
    },
    [applyFile, disabled],
  );

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-gray-700">Import from CSV</p>
      <p className="text-xs text-gray-500">
        Columns: <code className="text-[11px]">name,type,dueDate,quantity</code>
        . Drop a file here or click to browse, then press <strong>Send</strong>.
      </p>

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
          disabled
            ? "cursor-not-allowed border-gray-200 bg-gray-50 opacity-60"
            : dragOver
              ? "cursor-copy border-blue-400 bg-blue-50/80"
              : file
                ? "cursor-pointer border-blue-300 bg-blue-50/50"
                : "cursor-pointer border-gray-200 bg-gray-50/80 hover:border-blue-300 hover:bg-blue-50/40"
        }`}
      >
        <Upload
          className={`h-8 w-8 ${dragOver || file ? "text-blue-600" : "text-gray-400"}`}
          aria-hidden
        />
        {file ? (
          <>
            <p className="text-sm font-medium text-gray-900">{file.name}</p>
            <p className="text-xs text-gray-500">
              Ready — press Send to import
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">
              Drag & drop CSV here
            </p>
            <p className="text-xs text-gray-500">or click to choose a file</p>
          </>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            applyFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>

      {file && !disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            applyFile(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          className="text-xs font-medium text-gray-500 hover:text-gray-800"
        >
          Remove file
        </button>
      )}

      {pickError && (
        <p className="text-xs text-red-600" role="alert">
          {pickError}
        </p>
      )}
    </div>
  );
}
