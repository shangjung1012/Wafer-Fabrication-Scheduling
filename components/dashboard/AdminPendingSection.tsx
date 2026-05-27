"use client";

import React from "react";

type FactoryDailyCell = {
  date: string;
  orderCount: number;
  totalQuantity: number;
  percent: number;
};

type FactoryMatrixRow = {
  factoryId: string;
  label: string;
  productionType: string;
  totalQuantity: number;
  totalOrders: number;
  cells: FactoryDailyCell[];
};

export function AdminPendingSection({
  rows,
  dateColumns,
  dateRangeLabel,
}: {
  rows: FactoryMatrixRow[];
  dateColumns: string[];
  dateRangeLabel: string;
}) {
  const totalQuantity = rows.reduce((sum, row) => sum + row.totalQuantity, 0);
  const totalOrders = rows.reduce((sum, row) => sum + row.totalOrders, 0);

  return (
    <>
      <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              未來 7 天工廠總覽
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {dateRangeLabel || "Next 7 days"}
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>
              Orders:{" "}
              <span className="font-semibold text-gray-700">
                {totalOrders.toLocaleString()}
              </span>
            </div>
            <div>
              Qty:{" "}
              <span className="font-semibold text-gray-700">
                {totalQuantity.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {rows.length === 0 ? (
          <p className="mt-10 text-center text-sm text-gray-400">
            No production data for the next 7 days.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-gray-200 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-500">
                    Factory
                  </th>
                  {dateColumns.map((date) => (
                    <th
                      key={date}
                      className="border-b border-gray-200 px-3 py-3 text-center font-semibold text-gray-500"
                    >
                      {date.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.factoryId}
                    className={index % 2 === 0 ? "bg-white" : "bg-gray-50/40"}
                  >
                    <td className="sticky left-0 z-10 border-b border-gray-100 bg-inherit px-4 py-3 align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-gray-800">
                          {row.label}
                        </span>
                      </div>
                    </td>
                    {row.cells.map((cell) => (
                      <td
                        key={`${row.factoryId}__${cell.date}`}
                        className="border-b border-gray-100 px-3 py-3 align-middle"
                      >
                        <div
                          className="rounded-xl border border-gray-100 bg-gray-50 px-2 py-2 text-center shadow-sm transition-colors hover:border-blue-200"
                          title={`${cell.orderCount} orders, ${cell.totalQuantity.toLocaleString()} qty`}
                        >
                          <div className="text-sm font-semibold text-gray-900">
                            {cell.orderCount.toLocaleString()}
                          </div>
                          <div className="mt-0.5 text-[10px] text-gray-500">
                            {cell.percent.toFixed(0)}%
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{
                                width: `${Math.min(100, cell.percent)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
