"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

import {
  logoutClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type Role = ClientAuthSession["user"]["role"];

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

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  badge?: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #dbe3ef",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
        background: "#ffffff",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}
        >
          {title}
        </h2>
        {badge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: 99,
              background:
                badge === "SALES"
                  ? "#dcfce7"
                  : badge === "ADMIN"
                    ? "#dbeafe"
                    : "#f3e8ff",
              color:
                badge === "SALES"
                  ? "#166534"
                  : badge === "ADMIN"
                    ? "#1e40af"
                    : "#6b21a8",
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Result({ data }: { data: unknown }) {
  if (data === null) return null;
  return (
    <pre
      style={{
        background: "#f8fafc",
        border: "1px solid #dbe3ef",
        borderRadius: 6,
        padding: 10,
        marginTop: 10,
        fontSize: 12,
        color: "#1e293b",
        overflowX: "auto",
        maxHeight: 200,
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

type OrderRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string;
  quantity: number;
  applicantId: string;
  lastModifiedById: string | null;
};

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  PENDING: { bg: "#fef9c3", color: "#854d0e" },
  APPROVED: { bg: "#dbeafe", color: "#1e40af" },
  SCHEDULED: { bg: "#e0f2fe", color: "#075985" },
  IN_PRODUCTION: { bg: "#dcfce7", color: "#166534" },
  COMPLETED: { bg: "#f3f4f6", color: "#374151" },
  CANCELLED: { bg: "#fee2e2", color: "#991b1b" },
};

function OrderTable({ data }: { data: unknown }) {
  if (!Array.isArray(data) || data.length === 0) return null;

  const orders = data as OrderRow[];

  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
      >
        <thead>
          <tr
            style={{ background: "#f8fafc", borderBottom: "2px solid #dbe3ef" }}
          >
            {[
              "Name",
              "Type",
              "Status",
              "Due Date",
              "Qty",
              "Applicant",
              "Last Modified By",
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "6px 10px",
                  textAlign: "left",
                  fontWeight: 600,
                  color: "#1e293b",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => {
            const sc = STATUS_COLOR[o.status] ?? {
              bg: "#f3f4f6",
              color: "#1e293b",
            };
            return (
              <tr
                key={o.id}
                style={{
                  borderBottom: "1px solid #f3f4f6",
                  background: i % 2 === 0 ? "#fff" : "#fafafa",
                }}
              >
                <td
                  style={{
                    padding: "6px 10px",
                    fontWeight: 500,
                    color: "#0f172a",
                  }}
                >
                  {o.name}
                </td>
                <td style={{ padding: "6px 10px", color: "#475569" }}>
                  {o.type}
                </td>
                <td style={{ padding: "6px 10px" }}>
                  <span
                    style={{
                      background: sc.bg,
                      color: sc.color,
                      padding: "2px 7px",
                      borderRadius: 99,
                      fontWeight: 600,
                      fontSize: 11,
                    }}
                  >
                    {o.status}
                  </span>
                </td>
                <td
                  style={{
                    padding: "6px 10px",
                    color: "#334155",
                    whiteSpace: "nowrap",
                  }}
                >
                  {o.dueDate.slice(0, 10)}
                </td>
                <td
                  style={{
                    padding: "6px 10px",
                    color: "#334155",
                    textAlign: "right",
                  }}
                >
                  {o.quantity.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: "6px 10px",
                    fontFamily: "monospace",
                    color: "#1d4ed8",
                  }}
                >
                  {o.applicantId}
                </td>
                <td
                  style={{
                    padding: "6px 10px",
                    fontFamily: "monospace",
                    color: o.lastModifiedById ? "#6d28d9" : "#64748b",
                  }}
                >
                  {o.lastModifiedById ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>
        {orders.length} order(s)
      </p>
    </div>
  );
}

function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label
      style={{
        display: "block",
        marginBottom: 6,
        fontSize: 13,
        color: "#334155",
        fontWeight: 650,
      }}
    >
      {label}
      <input
        {...props}
        style={{
          display: "block",
          width: "100%",
          padding: "4px 8px",
          marginTop: 2,
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          fontSize: 13,
          color: "#0f172a",
          background: "#fff",
          boxSizing: "border-box",
        }}
      />
    </label>
  );
}

function Btn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: "#2563eb",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 700,
        marginTop: 8,
      }}
    >
      {children}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 16,
        borderBottom: "2px solid #2563eb",
        paddingBottom: 4,
        margin: "24px 0 16px",
        color: "#0f172a",
      }}
    >
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Role-access matrix
//
// SALES:      List Orders, Get Order, Create Order, Update Order (no status),
//             List Requests, Create Request, Update Request
//
// ADMIN:      List Orders, Get Order, Update Order (with status), Delete Orders,
//             Import CSV, List Requests, Approve Request
//
// SUPERADMIN: List Orders, Get Order, Import CSV,
//             List Requests, Approve Request
// ---------------------------------------------------------------------------

export default function OrdersPage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const role: Role = session?.user.role ?? "SALES";

  const isSales = role === "SALES";
  const isAdmin = role === "ADMIN";
  const isSuperAdmin = role === "SUPERADMIN";
  const isAdminOrSuper = isAdmin || isSuperAdmin;

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [router, session]);

  // ---- List Orders ----
  const [listResult, setListResult] = useState<unknown>(null);
  const [listStatus, setListStatus] = useState("");
  const [listKeyword, setListKeyword] = useState("");

  const doListOrders = useCallback(async () => {
    const qs = listKeyword ? `?keyword=${encodeURIComponent(listKeyword)}` : "";
    const res = await apiFetch(`/api/orders${qs}`);
    setListResult(await res.json());
    setListStatus(`${res.status}`);
  }, [listKeyword]);

  // ---- Get Order ----
  const [getOrderId, setGetOrderId] = useState("");
  const [getResult, setGetResult] = useState<unknown>(null);
  const [getStatus, setGetStatus] = useState("");

  const doGetOrder = useCallback(async () => {
    const res = await apiFetch(`/api/orders/${getOrderId}`);
    setGetResult(await res.json());
    setGetStatus(`${res.status}`);
  }, [getOrderId]);

  // ---- Create Order (SALES) ----
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState("A");
  const [createDueDate, setCreateDueDate] = useState("2026-12-31");
  const [createQty, setCreateQty] = useState("100");
  const [createResult, setCreateResult] = useState<unknown>(null);
  const [createStatus, setCreateStatus] = useState("");

  const doCreateOrder = useCallback(async () => {
    const res = await apiFetch("/api/orders", {
      method: "POST",
      body: JSON.stringify({
        name: createName,
        type: createType,
        dueDate: new Date(createDueDate).toISOString(),
        quantity: Number(createQty),
      }),
    });
    setCreateResult(await res.json());
    setCreateStatus(`${res.status}`);
  }, [createName, createType, createDueDate, createQty]);

  // ---- Update Order ----
  const [updateId, setUpdateId] = useState("");
  const [updateName, setUpdateName] = useState("");
  const [updateQty, setUpdateQty] = useState("");
  const [updateDueDate, setUpdateDueDate] = useState("");
  const [updateStatus2, setUpdateStatus2] = useState(""); // new status value
  const [updateResult, setUpdateResult] = useState<unknown>(null);
  const [updateHttpStatus, setUpdateHttpStatus] = useState("");

  const doUpdateOrder = useCallback(async () => {
    const body: Record<string, unknown> = {};
    if (updateName) body.name = updateName;
    if (updateQty) body.quantity = Number(updateQty);
    if (updateDueDate) body.dueDate = new Date(updateDueDate).toISOString();
    if (isAdminOrSuper && updateStatus2) body.status = updateStatus2;
    const res = await apiFetch(`/api/orders/${updateId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setUpdateResult(await res.json());
    setUpdateHttpStatus(`${res.status}`);
  }, [
    updateId,
    updateName,
    updateQty,
    updateDueDate,
    updateStatus2,
    isAdminOrSuper,
  ]);

  // ---- Delete Orders (ADMIN) ----
  const [deleteIds, setDeleteIds] = useState("");
  const [deleteResult, setDeleteResult] = useState<unknown>(null);
  const [deleteStatus, setDeleteStatus] = useState("");

  const doDeleteOrders = useCallback(async () => {
    const ids = deleteIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await apiFetch("/api/orders", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    setDeleteResult(await res.json());
    setDeleteStatus(`${res.status}`);
  }, [deleteIds]);

  // ---- Import CSV (ADMIN + SUPERADMIN) ----
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<unknown>(null);
  const [importStatus, setImportStatus] = useState("");

  const doImport = useCallback(async () => {
    if (!csvFile) return;
    const form = new FormData();
    form.append("file", csvFile);
    const res = await fetch("/api/orders/import", {
      method: "POST",
      credentials: "same-origin",
      body: form,
    });
    setImportResult(await res.json());
    setImportStatus(`${res.status}`);
  }, [csvFile]);

  // ---- List Requests ----
  const [listReqResult, setListReqResult] = useState<unknown>(null);
  const [listReqStatus, setListReqStatus] = useState("");

  const doListRequests = useCallback(async () => {
    const res = await apiFetch("/api/requests");
    setListReqResult(await res.json());
    setListReqStatus(`${res.status}`);
  }, []);

  // ---- Create Request (SALES) ----
  const [reqOrderId, setReqOrderId] = useState("");
  const [reqMessage, setReqMessage] = useState("");
  const [reqPayload, setReqPayload] = useState("{}");
  const [createReqResult, setCreateReqResult] = useState<unknown>(null);
  const [createReqStatus, setCreateReqStatus] = useState("");

  const doCreateRequest = useCallback(async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(reqPayload);
    } catch {
      payload = {};
    }
    const res = await apiFetch("/api/requests", {
      method: "POST",
      body: JSON.stringify({
        orderId: reqOrderId,
        message: reqMessage,
        payload,
      }),
    });
    setCreateReqResult(await res.json());
    setCreateReqStatus(`${res.status}`);
  }, [reqOrderId, reqMessage, reqPayload]);

  // ---- Update Request (SALES) ----
  const [updateReqId, setUpdateReqId] = useState("");
  const [updateReqMessage, setUpdateReqMessage] = useState("");
  const [updateReqPayload, setUpdateReqPayload] = useState("");
  const [updateReqResult, setUpdateReqResult] = useState<unknown>(null);
  const [updateReqStatus, setUpdateReqStatus] = useState("");

  const doUpdateRequest = useCallback(async () => {
    const body: Record<string, unknown> = {};
    if (updateReqMessage) body.message = updateReqMessage;
    if (updateReqPayload.trim()) {
      try {
        body.payload = JSON.parse(updateReqPayload);
      } catch {
        body.payload = updateReqPayload;
      }
    }
    const res = await apiFetch(`/api/requests/${updateReqId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setUpdateReqResult(await res.json());
    setUpdateReqStatus(`${res.status}`);
  }, [updateReqId, updateReqMessage, updateReqPayload]);

  // ---- Approve Request (ADMIN + SUPERADMIN) ----
  const [approveReqId, setApproveReqId] = useState("");
  const [approveResult, setApproveResult] = useState<unknown>(null);
  const [approveStatus, setApproveStatus] = useState("");

  const doApprove = useCallback(async () => {
    const res = await apiFetch(`/api/requests/${approveReqId}/approve`, {
      method: "POST",
    });
    setApproveResult(await res.json());
    setApproveStatus(`${res.status}`);
  }, [approveReqId]);

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  }, [router]);

  // ---------------------------------------------------------------------------
  // Role badge colour
  // ---------------------------------------------------------------------------

  const roleBadgeStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    padding: "3px 10px",
    borderRadius: 99,
    background: isSales ? "#dcfce7" : isAdmin ? "#dbeafe" : "#f3e8ff",
    color: isSales ? "#166534" : isAdmin ? "#1e40af" : "#6b21a8",
  };

  const navLinkStyle: React.CSSProperties = {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: "7px 11px",
    color: "#334155",
    background: "#fff",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 650,
  };

  const pageShellStyle: React.CSSProperties = {
    fontFamily: "system-ui, sans-serif",
    maxWidth: 800,
    minHeight: "100vh",
    margin: "0 auto",
    padding: 24,
    color: "#0f172a",
    background: "#f8fafc",
    boxShadow: "0 0 0 100vmax #f8fafc",
    clipPath: "inset(0 -100vmax)",
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (session === undefined) {
    return <div style={pageShellStyle}>Loading session...</div>;
  }

  if (session === null) {
    return <div style={pageShellStyle}>Redirecting to login...</div>;
  }

  return (
    <div style={pageShellStyle}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        WOMS — API Test UI
      </h1>
      <nav
        aria-label="Dashboard navigation"
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          margin: "12px 0 18px",
        }}
      >
        <a href="/orders" style={navLinkStyle}>
          Orders
        </a>
        <a href="/conflicts" style={navLinkStyle}>
          Conflicts
        </a>
        <a href="/visualization" style={navLinkStyle}>
          Visualization
        </a>
        <a href="/users" style={navLinkStyle}>
          Users
        </a>
        <a href="/profile" style={navLinkStyle}>
          Profile
        </a>
      </nav>

      <div
        style={{
          marginBottom: 24,
          padding: 12,
          background: "#f0f4ff",
          color: "#1e293b",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Signed in as:</span>
        <strong style={{ fontSize: 13 }}>{session.user.username}</strong>
        <span style={{ fontSize: 12, color: "#334155" }}>
          ({session.user.email})
        </span>
        <span style={roleBadgeStyle}>{role}</span>
        {session.user.group && (
          <span style={{ fontSize: 12, color: "#334155" }}>
            Group {session.user.group}
          </span>
        )}
        <button
          type="button"
          onClick={handleLogout}
          style={{
            marginLeft: "auto",
            padding: "5px 10px",
            fontSize: 13,
            borderRadius: 4,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>

      {/* Role capability summary */}
      <div
        style={{
          marginBottom: 24,
          padding: 12,
          background: "#fffbeb",
          borderRadius: 8,
          border: "1px solid #fde68a",
          color: "#713f12",
          fontSize: 13,
        }}
      >
        {isSales && (
          <span>
            As <strong>SALES</strong>: view orders, create &amp; edit your own
            orders, submit and edit change requests.
          </span>
        )}
        {isAdmin && (
          <span>
            As <strong>ADMIN</strong>: view orders in your group, update order
            status, delete orders, import CSV, approve requests.
          </span>
        )}
        {isSuperAdmin && (
          <span>
            As <strong>SUPERADMIN</strong>: view all orders in your production
            type, import CSV, approve requests.
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Orders section                                                      */}
      {/* ------------------------------------------------------------------ */}
      <SectionHeading>Orders</SectionHeading>

      {/* 1. List Orders — all roles */}
      <Section title="List Orders — GET /api/orders">
        <Input
          label="Keyword (optional)"
          value={listKeyword}
          onChange={(e) => setListKeyword(e.target.value)}
          placeholder="search name/type"
        />
        <Btn onClick={doListOrders}>Send</Btn>
        {listStatus && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
            HTTP {listStatus}
          </span>
        )}
        <OrderTable data={listResult} />
      </Section>

      {/* 2. Get Order — all roles */}
      <Section title="Get Order — GET /api/orders/:id">
        <Input
          label="Order ID"
          value={getOrderId}
          onChange={(e) => setGetOrderId(e.target.value)}
          placeholder="order id"
        />
        <Btn onClick={doGetOrder}>Send</Btn>
        {getStatus && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
            HTTP {getStatus}
          </span>
        )}
        <Result data={getResult} />
      </Section>

      {/* 3. Create Order — SALES only */}
      {isSales && (
        <Section title="Create Order — POST /api/orders" badge="SALES">
          <Input
            label="Name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Order name"
          />
          <Input
            label="Type (production group: A/B/C)"
            value={createType}
            onChange={(e) => setCreateType(e.target.value)}
            placeholder="A"
          />
          <Input
            label="Due Date"
            type="date"
            value={createDueDate}
            onChange={(e) => setCreateDueDate(e.target.value)}
          />
          <Input
            label="Quantity"
            type="number"
            value={createQty}
            onChange={(e) => setCreateQty(e.target.value)}
          />
          <Btn onClick={doCreateOrder}>Send</Btn>
          {createStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {createStatus}
            </span>
          )}
          <Result data={createResult} />
        </Section>
      )}

      {/* 4. Update Order — SALES (no status) or ADMIN (with status) */}
      {(isSales || isAdmin) && (
        <Section
          title="Update Order — PUT /api/orders/:id"
          badge={isSales ? "SALES" : "ADMIN"}
        >
          <Input
            label="Order ID"
            value={updateId}
            onChange={(e) => setUpdateId(e.target.value)}
            placeholder="order id"
          />
          <Input
            label="Name"
            value={updateName}
            onChange={(e) => setUpdateName(e.target.value)}
            placeholder="new name (optional)"
          />
          <Input
            label="Quantity"
            type="number"
            value={updateQty}
            onChange={(e) => setUpdateQty(e.target.value)}
            placeholder="new quantity (optional)"
          />
          <Input
            label="Due Date"
            type="date"
            value={updateDueDate}
            onChange={(e) => setUpdateDueDate(e.target.value)}
          />
          {isAdmin && (
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              Status (ADMIN only)
              <select
                value={updateStatus2}
                onChange={(e) => setUpdateStatus2(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "4px 8px",
                  marginTop: 2,
                  border: "1px solid #cbd5e1",
                  borderRadius: 4,
                  fontSize: 13,
                }}
              >
                <option value="">(leave unchanged)</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="SCHEDULED">SCHEDULED</option>
                <option value="IN_PRODUCTION">IN_PRODUCTION</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </label>
          )}
          {isSales && (
            <p style={{ fontSize: 12, color: "#475569", margin: "4px 0 0" }}>
              Only works on your own PENDING orders. Status cannot be changed by
              SALES.
            </p>
          )}
          <Btn onClick={doUpdateOrder}>Send</Btn>
          {updateHttpStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {updateHttpStatus}
            </span>
          )}
          <Result data={updateResult} />
        </Section>
      )}

      {/* 5. Delete Orders — ADMIN only */}
      {isAdmin && (
        <Section title="Delete Orders — DELETE /api/orders" badge="ADMIN">
          <p style={{ fontSize: 12, color: "#475569", margin: "0 0 8px" }}>
            Soft-deletes (sets status = CANCELLED).
          </p>
          <Input
            label="Order IDs (comma-separated)"
            value={deleteIds}
            onChange={(e) => setDeleteIds(e.target.value)}
            placeholder="id1, id2, id3"
          />
          <Btn onClick={doDeleteOrders}>Send</Btn>
          {deleteStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {deleteStatus}
            </span>
          )}
          <Result data={deleteResult} />
        </Section>
      )}

      {/* 6. Import CSV — ADMIN + SUPERADMIN */}
      {isAdminOrSuper && (
        <Section
          title="Import CSV — POST /api/orders/import"
          badge={isAdmin ? "ADMIN" : "SUPERADMIN"}
        >
          <p style={{ fontSize: 12, color: "#334155", margin: "0 0 8px" }}>
            CSV columns: <code>name,type,dueDate,quantity</code>
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13 }}
          />
          <Btn onClick={doImport}>Send</Btn>
          {importStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {importStatus}
            </span>
          )}
          <Result data={importResult} />
        </Section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Requests section                                                    */}
      {/* ------------------------------------------------------------------ */}
      <SectionHeading>Requests</SectionHeading>

      {/* 7. List Requests — all roles */}
      <Section title="List Requests — GET /api/requests">
        <Btn onClick={doListRequests}>Send</Btn>
        {listReqStatus && (
          <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
            HTTP {listReqStatus}
          </span>
        )}
        <Result data={listReqResult} />
      </Section>

      {/* 8. Create Request — SALES only */}
      {isSales && (
        <Section title="Create Request — POST /api/requests" badge="SALES">
          <Input
            label="Order ID"
            value={reqOrderId}
            onChange={(e) => setReqOrderId(e.target.value)}
            placeholder="order id"
          />
          <Input
            label="Message"
            value={reqMessage}
            onChange={(e) => setReqMessage(e.target.value)}
            placeholder="reason for request"
          />
          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
            Payload (JSON — fields to change on the order)
            <textarea
              value={reqPayload}
              onChange={(e) => setReqPayload(e.target.value)}
              rows={3}
              style={{
                display: "block",
                width: "100%",
                padding: "4px 8px",
                marginTop: 2,
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
            />
          </label>
          <Btn onClick={doCreateRequest}>Send</Btn>
          {createReqStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {createReqStatus}
            </span>
          )}
          <Result data={createReqResult} />
        </Section>
      )}

      {/* 9. Update Request — SALES only */}
      {isSales && (
        <Section title="Update Request — PUT /api/requests/:id" badge="SALES">
          <Input
            label="Request ID"
            value={updateReqId}
            onChange={(e) => setUpdateReqId(e.target.value)}
            placeholder="request id"
          />
          <Input
            label="New Message"
            value={updateReqMessage}
            onChange={(e) => setUpdateReqMessage(e.target.value)}
            placeholder="updated message (optional)"
          />
          <label
            style={{
              display: "block",
              marginBottom: 6,
              fontSize: 13,
              color: "#334155",
              fontWeight: 650,
            }}
          >
            Payload (JSON, optional)
            <textarea
              value={updateReqPayload}
              onChange={(e) => setUpdateReqPayload(e.target.value)}
              placeholder='{"field": "value"}'
              rows={3}
              style={{
                display: "block",
                width: "100%",
                padding: "4px 8px",
                marginTop: 2,
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "monospace",
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />
          </label>
          <Btn onClick={doUpdateRequest}>Send</Btn>
          {updateReqStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {updateReqStatus}
            </span>
          )}
          <Result data={updateReqResult} />
        </Section>
      )}

      {/* 10. Approve Request — ADMIN + SUPERADMIN */}
      {isAdminOrSuper && (
        <Section
          title="Approve Request — POST /api/requests/:id/approve"
          badge={isAdmin ? "ADMIN" : "SUPERADMIN"}
        >
          <p style={{ fontSize: 12, color: "#475569", margin: "0 0 8px" }}>
            Applies the request&apos;s payload fields to the linked order.
          </p>
          <Input
            label="Request ID"
            value={approveReqId}
            onChange={(e) => setApproveReqId(e.target.value)}
            placeholder="request id"
          />
          <Btn onClick={doApprove}>Send</Btn>
          {approveStatus && (
            <span style={{ marginLeft: 8, fontSize: 12, color: "#334155" }}>
              HTTP {approveStatus}
            </span>
          )}
          <Result data={approveResult} />
        </Section>
      )}
    </div>
  );
}
