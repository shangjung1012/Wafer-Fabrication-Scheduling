"use client";

import React, { useMemo, useState } from "react";
import { parseISO, format } from "date-fns";

type OrderRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string | null;
  quantity: number;
  applicantId: string;
  createdAt: string;
  updatedAt?: string;
  lastModifiedById: string | null;
};

type SortKey = "dueDate" | "name" | "quantity" | "status" | "scheduleDate";
type SortDirection = "asc" | "desc";

function formatDateValue(value?: string | null) {
  if (!value) return "—";
  try {
    const parsed = parseISO(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return format(parsed, "yyyy/MM/dd");
  } catch {
    return "—";
  }
}

const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 border-amber-200",
  SCHEDULED: "bg-indigo-100 text-indigo-700 border-indigo-200",
  IN_PRODUCTION: "bg-green-100 text-green-700 border-green-200",
  COMPLETED: "bg-gray-100 text-gray-600 border-gray-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {status}
    </span>
  );
}

export function SalesOrdersSection({
  orders,
  scheduleByOrderId,
  onEdit,
  onCreate,
  onFlag,
  flaggedOrderIds,
}: {
  orders: OrderRow[];
  scheduleByOrderId: Map<string, string>;
  onEdit: (order: OrderRow) => void;
  onCreate: () => void;
  onFlag?: (order: OrderRow) => void;
  flaggedOrderIds?: Set<string>;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("dueDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const filteredOrders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = [...orders].filter((order) => {
      if (statusFilter !== "ALL" && order.status !== statusFilter) return false;
      if (!query) return true;
      return [order.name, order.type, order.status, order.id]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    const compareText = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

    const compareDates = (
      a: string | null | undefined,
      b: string | null | undefined,
    ) => {
      const left = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
      const right = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
      return left - right;
    };

    list.sort((a, b) => {
      let result = 0;
      switch (sortKey) {
        case "name":
          result = compareText(a.name, b.name);
          break;
        case "quantity":
          result = a.quantity - b.quantity;
          break;
        case "status":
          result = compareText(a.status, b.status);
          break;
        case "scheduleDate":
          result = compareDates(
            scheduleByOrderId.get(a.id),
            scheduleByOrderId.get(b.id),
          );
          break;
        case "dueDate":
        default:
          result = compareDates(a.dueDate, b.dueDate);
          break;
      }
      return sortDirection === "asc" ? result : -result;
    });

    return list;
  }, [
    orders,
    searchQuery,
    statusFilter,
    sortKey,
    sortDirection,
    scheduleByOrderId,
  ]);

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-50/70 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
              My Orders
            </h2>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {orders.filter((o) => o.status === "PENDING").length} Pending
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Sort, filter, and search your orders
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          <span className="text-sm leading-none">+</span>
          New Order
        </button>
      </div>

      <div className="border-b border-gray-100 px-5 py-4">
        <div className="grid gap-3 xl:grid-cols-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 xl:col-span-2">
            Search
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search name, type, status, or order id"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Filter
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            >
              {[
                "ALL",
                "PENDING",
                "SCHEDULED",
                "IN_PRODUCTION",
                "COMPLETED",
                "CANCELLED",
              ].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Sort By
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            >
              <option value="dueDate">Due Date</option>
              <option value="name">Name</option>
              <option value="quantity">Quantity</option>
              <option value="status">Status</option>
              <option value="scheduleDate">Schedule Date</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Showing {filteredOrders.length} of {orders.length} orders
          </p>
          <button
            type="button"
            onClick={() =>
              setSortDirection((current) =>
                current === "asc" ? "desc" : "asc",
              )
            }
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            {sortDirection === "asc" ? "Ascending" : "Descending"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              {[
                "Name",
                "Quantity",
                "Due Date",
                "Status",
                "Schedule Date",
                "Actions",
              ].map((header) => (
                <th
                  key={header}
                  className="border-b border-gray-200 px-4 py-3 text-left font-semibold text-gray-500"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-gray-400"
                >
                  No matching orders.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order, index) => {
                const scheduleDate = scheduleByOrderId.get(order.id);
                const canEdit =
                  order.status === "PENDING" || order.status === "SCHEDULED";

                return (
                  <tr
                    key={order.id}
                    className={index % 2 === 0 ? "bg-white" : "bg-gray-50/60"}
                  >
                    <td className="border-b border-gray-100 px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {order.name}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-400">
                        {order.id}
                      </div>
                    </td>
                    <td className="border-b border-gray-100 px-4 py-3 text-gray-700">
                      {order.quantity.toLocaleString()}
                    </td>
                    <td className="border-b border-gray-100 px-4 py-3 text-gray-700">
                      {formatDateValue(order.dueDate)}
                    </td>
                    <td className="border-b border-gray-100 px-4 py-3">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="border-b border-gray-100 px-4 py-3 text-gray-700">
                      {scheduleDate ? formatDateValue(scheduleDate) : "—"}
                    </td>
                    <td className="border-b border-gray-100 px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => onEdit(order)}
                            className="rounded border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-gray-600 hover:text-gray-900"
                          >
                            Edit
                          </button>
                        )}
                        {canEdit &&
                          onFlag &&
                          (flaggedOrderIds?.has(order.id) ? (
                            <span className="rounded border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-semibold text-orange-600">
                              Flagged
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onFlag(order)}
                              className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-100"
                            >
                              Flag
                            </button>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
