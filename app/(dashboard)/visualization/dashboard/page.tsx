"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { addDays, format, parseISO } from "date-fns";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardSummary } from "@/components/dashboard/DashboardSummary";
import { AdminPendingSection } from "../../../../components/dashboard/AdminPendingSection";
import { SalesOrdersSection } from "@/components/dashboard/SalesOrdersSection";
import { ConflictIssueSection } from "@/components/dashboard/ConflictIssueSection";
import { X } from "lucide-react";

// Types
type TimelineResponse = {
  today?: string;
  conflicts: {
    factoryId: string;
    date: string;
    conflictType: string;
    severity: string;
    message: string;
  }[];
  factories?: {
    id: string;
    label: string;
    productionType: string;
    maxCapacity?: number;
  }[];
  dailyCapacities?: {
    factoryId: string;
    date: string;
    maxCapacity: number;
    usedCapacity: number;
  }[];
  timeline?: {
    orderId: string;
    factoryId: string;
    productionDate: string;
    assignedQuantity: number;
  }[];
};

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

type OrderEditorValues = {
  orderId?: string;
  name: string;
  quantity: string;
  type?: string;
  dueDate?: string;
};

// Helpers
function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
}

function OrderEditorModal({
  mode,
  title,
  initialValues,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  title: string;
  initialValues: OrderEditorValues;
  onClose: () => void;
  onSubmit: (values: OrderEditorValues) => Promise<void>;
}) {
  const isCreate = mode === "create";
  const [name, setName] = useState(initialValues.name);
  const [quantity, setQuantity] = useState(initialValues.quantity);
  const [type, setType] = useState(initialValues.type ?? "A");
  const [dueDate, setDueDate] = useState(initialValues.dueDate ?? "2026-12-31");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await onSubmit({
        orderId: initialValues.orderId,
        name: name.trim(),
        quantity: quantity.trim(),
        type: isCreate ? type.trim() : undefined,
        dueDate: isCreate ? dueDate : undefined,
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
                ? "Create a new sales order"
                : "Update the selected order's name or quantity."}
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
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {!isCreate && initialValues.orderId && (
            <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="font-semibold uppercase tracking-wide text-gray-400">
                  Order ID
                </div>
                <div className="mt-1 font-mono text-gray-700">
                  {initialValues.orderId}
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

          {isCreate && (
            <label className="block text-sm font-medium text-gray-700">
              Due Date
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </label>
          )}

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
              {submitting ? "Saving…" : isCreate ? "Send" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Shown only on first dashboard fetch so the shell + nav stay mounted (no full-page flash). */
function DashboardMainSkeleton({ variant }: { variant: "sales" | "admin" }) {
  return (
    <div
      className="flex flex-col flex-1 min-h-0 animate-pulse"
      aria-busy="true"
      aria-label="Loading dashboard content"
    >
      <div className="border-b border-gray-100 bg-gray-50/50 px-5 py-4">
        <div className="h-4 w-56 rounded bg-gray-200" />
        <div
          className={`mt-2 h-3 rounded bg-gray-100 ${variant === "admin" ? "w-72" : "w-64"}`}
        />
      </div>
      <div className="flex-1 space-y-3 overflow-hidden p-5">
        {Array.from({ length: variant === "sales" ? 6 : 5 }).map((_, i) => (
          <div
            key={i}
            className="h-12 rounded-lg bg-gray-100"
            style={{ width: `${85 + (i % 3) * 5}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardIssuesColumnSkeleton() {
  return (
    <div
      className="flex flex-1 min-h-0 flex-col p-5 animate-pulse"
      aria-busy="true"
      aria-label="Loading issues summary"
    >
      <div className="mb-4 h-8 w-2/3 max-w-xs rounded bg-gray-100" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-gray-100 bg-gray-50"
          />
        ))}
      </div>
    </div>
  );
}

// Main component
export default function DashboardPage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const [timelineData, setTimelineData] = useState<TimelineResponse | null>(
    null,
  );
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** After first fetch completes (success or error); avoids skeleton on refresh. */
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderEditorValues | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [flagBanner, setFlagBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [flaggedOrderIds, setFlaggedOrderIds] = useState<Set<string>>(
    new Set(),
  );

  const isSales = session?.user.role === "SALES";
  const isAdmin =
    session?.user.role === "ADMIN" || session?.user.role === "SUPERADMIN";

  useEffect(() => {
    if (session === null) {
      router.replace("/login");
      return;
    }
    if (session === undefined) return;

    let cancelled = false;

    Promise.all([
      apiFetch("/api/orders").then(async (res) => {
        const body = await res.json().catch(() => [] as OrderRow[]);
        return Array.isArray(body) ? body : (body.data ?? []);
      }),
      apiFetch("/api/visualization/timeline").then(async (res) => {
        const body = await res.json().catch(() => ({}) as TimelineResponse);
        return body as TimelineResponse;
      }),
      apiFetch("/api/conflict-issues").then(async (res) => {
        const body = await res.json().catch(() => []);
        return Array.isArray(body) ? body : [];
      }),
    ])
      .then(([ordersRes, timelineRes, issuesRes]) => {
        if (cancelled) return;
        setOrders(ordersRes);
        setTimelineData(timelineRes);
        const flagged = new Set<string>(
          (issuesRes as { orderId: string; status: string; title: string }[])
            .filter(
              (i) =>
                (i.status === "OPEN" || i.status === "IN_DISCUSSION") &&
                i.title.startsWith("Cancellation Request"),
            )
            .map((i) => i.orderId),
        );
        setFlaggedOrderIds((prev) => new Set([...prev, ...flagged]));
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setHasFetchedOnce(true);
      });

    return () => {
      cancelled = true;
    };
  }, [session, router, refreshKey]);

  const scheduleByOrderId = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of timelineData?.timeline ?? []) {
      const current = map.get(item.orderId);
      if (!current || item.productionDate < current) {
        map.set(item.orderId, item.productionDate);
      }
    }
    return map;
  }, [timelineData]);

  /** Status cards + FAILED banner: scope to the same orders the user may see (defense in depth vs API). */
  const ordersForStatusCounts = useMemo(() => {
    if (!session?.user) return orders;
    if (session.user.role === "SALES") {
      return orders.filter((o) => o.applicantId === session.user.id);
    }
    if (session.user.role === "ADMIN" || session.user.role === "SUPERADMIN") {
      const g = session.user.group;
      if (g) return orders.filter((o) => o.type === g);
    }
    return orders;
  }, [orders, session]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      PENDING: 0,
      SCHEDULED: 0,
      IN_PRODUCTION: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      FAILED: 0,
    };
    for (const order of ordersForStatusCounts) {
      if (order.status in counts) {
        counts[order.status]++;
      }
    }
    return counts;
  }, [ordersForStatusCounts]);

  const dateColumns = useMemo(() => {
    const today = timelineData?.today ?? format(new Date(), "yyyy-MM-dd");
    return Array.from({ length: 7 }, (_, index) =>
      format(addDays(parseISO(today), index), "yyyy-MM-dd"),
    );
  }, [timelineData]);

  const factoryMatrix = useMemo(() => {
    const factories = timelineData?.factories ?? [];
    const dateSet = new Set(dateColumns);

    const maxCapacityByFactoryAndDate = new Map<string, number>();
    for (const dc of timelineData?.dailyCapacities ?? []) {
      if (!dateSet.has(dc.date)) continue;
      maxCapacityByFactoryAndDate.set(
        `${dc.factoryId}__${dc.date}`,
        dc.maxCapacity,
      );
    }

    const rows = new Map<string, FactoryMatrixRow>(
      factories.map((factory) => [
        factory.id,
        {
          factoryId: factory.id,
          label: factory.label,
          productionType: factory.productionType,
          totalQuantity: 0,
          totalOrders: 0,
          cells: dateColumns.map((date) => ({
            date,
            orderCount: 0,
            totalQuantity: 0,
            percent: 0,
          })),
        },
      ]),
    );

    const orderIdsByFactory = new Map<string, Set<string>>();
    const orderIdsByFactoryAndDate = new Map<string, Set<string>>();

    for (const item of timelineData?.timeline ?? []) {
      if (!dateSet.has(item.productionDate)) continue;

      const row = rows.get(item.factoryId);
      if (!row) continue;

      const cell = row.cells.find(
        (entry) => entry.date === item.productionDate,
      );
      if (!cell) continue;

      row.totalQuantity += item.assignedQuantity;
      const rowOrderIds =
        orderIdsByFactory.get(item.factoryId) ?? new Set<string>();
      rowOrderIds.add(item.orderId);
      orderIdsByFactory.set(item.factoryId, rowOrderIds);

      const cellKey = `${item.factoryId}__${item.productionDate}`;
      const cellOrderIds =
        orderIdsByFactoryAndDate.get(cellKey) ?? new Set<string>();
      cellOrderIds.add(item.orderId);
      orderIdsByFactoryAndDate.set(cellKey, cellOrderIds);

      cell.totalQuantity += item.assignedQuantity;
    }

    for (const row of rows.values()) {
      row.totalOrders = orderIdsByFactory.get(row.factoryId)?.size ?? 0;
      const factoryBaselineMax =
        factories.find((f) => f.id === row.factoryId)?.maxCapacity ?? 0;
      for (const cell of row.cells) {
        const cellKey = `${row.factoryId}__${cell.date}`;
        cell.orderCount = orderIdsByFactoryAndDate.get(cellKey)?.size ?? 0;
        const maxForDay =
          maxCapacityByFactoryAndDate.get(cellKey) ?? factoryBaselineMax;
        cell.percent =
          maxForDay > 0 ? (cell.totalQuantity / maxForDay) * 100 : 0;
      }
    }

    return Array.from(rows.values()).sort((a, b) => {
      if (b.totalQuantity !== a.totalQuantity) {
        return b.totalQuantity - a.totalQuantity;
      }
      return a.label.localeCompare(b.label);
    });
  }, [timelineData, dateColumns]);

  const handleCreateOrder = async (values: OrderEditorValues) => {
    const name = values.name.trim();
    const type = values.type?.trim();
    const dueDate = values.dueDate;
    const quantity = Number(values.quantity);

    if (!name) throw new Error("Name is required.");
    if (!type || !["A", "B", "C"].includes(type)) {
      throw new Error("Type must be A, B, or C.");
    }
    if (!dueDate) throw new Error("Due date is required.");
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive integer.");
    }

    const res = await apiFetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        name,
        type,
        dueDate: new Date(dueDate).toISOString(),
        quantity,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message ?? `Create order failed (${res.status})`);
    }

    setCreateOpen(false);
    setLoading(true);
    setRefreshKey((value) => value + 1);
  };

  const handleUpdateOrder = async (values: OrderEditorValues) => {
    if (!values.orderId) throw new Error("Order ID is missing.");

    const payload: Record<string, unknown> = {};
    const name = values.name.trim();
    const quantityRaw = values.quantity.trim();

    if (name) payload.name = name;
    if (quantityRaw) {
      const quantity = Number(quantityRaw);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("Quantity must be a positive integer.");
      }
      payload.quantity = quantity;
    }

    if (Object.keys(payload).length === 0) {
      throw new Error("Name or quantity is required.");
    }

    const res = await apiFetch(`/api/orders/${values.orderId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message ?? `Update order failed (${res.status})`);
    }

    setEditOrder(null);
    setLoading(true);
    setRefreshKey((value) => value + 1);
  };

  const handleFlagOrder = async (order: OrderRow) => {
    const res = await apiFetch(`/api/orders/${order.id}/cancel-request`, {
      method: "POST",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFlagBanner({
        type: "error",
        message:
          (body as { error?: string }).error ??
          "Failed to submit cancellation request.",
      });
    } else {
      setFlagBanner({
        type: "success",
        message: "Cancellation request submitted. Admins have been notified.",
      });
      setFlaggedOrderIds((prev) => new Set(prev).add(order.id));
    }
    setTimeout(() => setFlagBanner(null), 5000);
  };

  if (session === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Loading session…
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        Redirecting to login…
      </div>
    );
  }

  const showMainSkeleton = loading && !hasFetchedOnce;

  const leftSection = showMainSkeleton ? (
    <DashboardMainSkeleton variant={isSales && !isAdmin ? "sales" : "admin"} />
  ) : isSales && !isAdmin ? (
    <SalesOrdersSection
      orders={orders}
      scheduleByOrderId={scheduleByOrderId}
      onEdit={(order) =>
        setEditOrder({
          orderId: order.id,
          name: order.name,
          quantity: order.quantity.toString(),
        })
      }
      onCreate={() => setCreateOpen(true)}
      onFlag={(order) => void handleFlagOrder(order)}
      flaggedOrderIds={flaggedOrderIds}
    />
  ) : (
    <AdminPendingSection
      rows={factoryMatrix}
      dateColumns={dateColumns}
      dateRangeLabel={
        timelineData
          ? `${timelineData.today ?? format(new Date(), "yyyy-MM-dd")} ~ ${format(addDays(parseISO(timelineData.today ?? format(new Date(), "yyyy-MM-dd")), 6), "yyyy-MM-dd")}`
          : ""
      }
    />
  );

  const rightSection = showMainSkeleton ? (
    <DashboardIssuesColumnSkeleton />
  ) : (
    <ConflictIssueSection />
  );

  return (
    <>
      <DashboardShell
        title={isSales && !isAdmin ? "Sales Dashboard" : "Admin Dashboard"}
        subtitle={
          isSales && !isAdmin
            ? "Manage your orders and approvals"
            : "Review next 7 days factory load and production status"
        }
        topSection={<DashboardSummary statusCounts={statusCounts} />}
        leftSection={leftSection}
        rightSection={rightSection}
        leftSectionClassName="flex-[5]"
        rightSectionClassName="flex-[3]"
        onBack={() => router.push("/visualization")}
      />

      {/* Modals — mount only when open so form state resets without an effect */}
      {createOpen && (
        <OrderEditorModal
          mode="create"
          title="New Order"
          initialValues={{
            name: "",
            quantity: "1",
            type: "A",
            dueDate: "2026-12-31",
          }}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreateOrder}
        />
      )}

      {editOrder && (
        <OrderEditorModal
          key={editOrder.orderId ?? "edit"}
          mode="edit"
          title="Edit Order"
          initialValues={editOrder}
          onClose={() => setEditOrder(null)}
          onSubmit={handleUpdateOrder}
        />
      )}

      {flagBanner && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
            flagBanner.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {flagBanner.message}
        </div>
      )}
    </>
  );
}
