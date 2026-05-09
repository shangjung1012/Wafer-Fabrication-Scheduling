"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

const DEV_USERS = [
  { label: "SUPERADMIN sa-A", token: "dev:SUPERADMIN:sa-A" },
  { label: "SUPERADMIN sa-B", token: "dev:SUPERADMIN:sa-B" },
  { label: "ADMIN admin-A1",  token: "dev:ADMIN:admin-A1" },
  { label: "ADMIN admin-A2",  token: "dev:ADMIN:admin-A2" },
  { label: "ADMIN admin-A3",  token: "dev:ADMIN:admin-A3" },
  { label: "SALES sales-A",   token: "dev:SALES:sales-A" },
  { label: "SALES sales-B",   token: "dev:SALES:sales-B" },
];

type Role = "SUPERADMIN" | "ADMIN" | "SALES";

function parseRole(token: string): Role {
  const part = token.split(":")[1] ?? "";
  if (part === "SUPERADMIN" || part === "ADMIN" || part === "SALES") return part;
  return "SALES";
}

function useToken() {
  const [token, setTokenState] = useState(DEV_USERS[0].token);

  useEffect(() => {
    const saved = localStorage.getItem("dev_token");
    if (saved) setTokenState(saved);
  }, []);

  const setToken = (t: string) => {
    localStorage.setItem("dev_token", t);
    setTokenState(t);
  };

  return { token, setToken };
}

function apiFetch(token: string, path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Section({ title, children, badge }: { title: string; children: React.ReactNode; badge?: string }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
        {badge && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 99,
            background: badge === "SALES" ? "#dcfce7" : badge === "ADMIN" ? "#dbeafe" : "#f3e8ff",
            color: badge === "SALES" ? "#166534" : badge === "ADMIN" ? "#1e40af" : "#6b21a8",
          }}>
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
    <pre style={{
      background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 4,
      padding: 10, marginTop: 10, fontSize: 12, overflowX: "auto", maxHeight: 200,
    }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Input({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
      {label}
      <input
        {...props}
        style={{
          display: "block", width: "100%", padding: "4px 8px", marginTop: 2,
          border: "1px solid #ccc", borderRadius: 4, fontSize: 13, boxSizing: "border-box",
        }}
      />
    </label>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", background: "#1d4ed8", color: "#fff",
        border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13, marginTop: 8,
      }}
    >
      {children}
    </button>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 16, borderBottom: "2px solid #1d4ed8", paddingBottom: 4, margin: "24px 0 16px" }}>
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
  const { token, setToken } = useToken();
  const role = parseRole(token);

  const isSales = role === "SALES";
  const isAdmin = role === "ADMIN";
  const isSuperAdmin = role === "SUPERADMIN";
  const isAdminOrSuper = isAdmin || isSuperAdmin;

  // ---- List Orders ----
  const [listResult, setListResult] = useState<unknown>(null);
  const [listStatus, setListStatus] = useState("");
  const [listKeyword, setListKeyword] = useState("");

  const doListOrders = useCallback(async () => {
    const qs = listKeyword ? `?keyword=${encodeURIComponent(listKeyword)}` : "";
    const res = await apiFetch(token, `/api/orders${qs}`);
    setListResult(await res.json());
    setListStatus(`${res.status}`);
  }, [token, listKeyword]);

  // ---- Get Order ----
  const [getOrderId, setGetOrderId] = useState("");
  const [getResult, setGetResult] = useState<unknown>(null);
  const [getStatus, setGetStatus] = useState("");

  const doGetOrder = useCallback(async () => {
    const res = await apiFetch(token, `/api/orders/${getOrderId}`);
    setGetResult(await res.json());
    setGetStatus(`${res.status}`);
  }, [token, getOrderId]);

  // ---- Create Order (SALES) ----
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState("A");
  const [createDueDate, setCreateDueDate] = useState("2026-12-31");
  const [createQty, setCreateQty] = useState("100");
  const [createResult, setCreateResult] = useState<unknown>(null);
  const [createStatus, setCreateStatus] = useState("");

  const doCreateOrder = useCallback(async () => {
    const res = await apiFetch(token, "/api/orders", {
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
  }, [token, createName, createType, createDueDate, createQty]);

  // ---- Update Order ----
  const [updateId, setUpdateId] = useState("");
  const [updateName, setUpdateName] = useState("");
  const [updateQty, setUpdateQty] = useState("");
  const [updateStatus2, setUpdateStatus2] = useState("");  // new status value
  const [updateResult, setUpdateResult] = useState<unknown>(null);
  const [updateHttpStatus, setUpdateHttpStatus] = useState("");

  const doUpdateOrder = useCallback(async () => {
    const body: Record<string, unknown> = {};
    if (updateName) body.name = updateName;
    if (updateQty) body.quantity = Number(updateQty);
    if (isAdminOrSuper && updateStatus2) body.status = updateStatus2;
    const res = await apiFetch(token, `/api/orders/${updateId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    setUpdateResult(await res.json());
    setUpdateHttpStatus(`${res.status}`);
  }, [token, updateId, updateName, updateQty, updateStatus2, isAdminOrSuper]);

  // ---- Delete Orders (ADMIN) ----
  const [deleteIds, setDeleteIds] = useState("");
  const [deleteResult, setDeleteResult] = useState<unknown>(null);
  const [deleteStatus, setDeleteStatus] = useState("");

  const doDeleteOrders = useCallback(async () => {
    const ids = deleteIds.split(",").map((s) => s.trim()).filter(Boolean);
    const res = await apiFetch(token, "/api/orders", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    setDeleteResult(await res.json());
    setDeleteStatus(`${res.status}`);
  }, [token, deleteIds]);

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
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    setImportResult(await res.json());
    setImportStatus(`${res.status}`);
  }, [token, csvFile]);

  // ---- List Requests ----
  const [listReqResult, setListReqResult] = useState<unknown>(null);
  const [listReqStatus, setListReqStatus] = useState("");

  const doListRequests = useCallback(async () => {
    const res = await apiFetch(token, "/api/requests");
    setListReqResult(await res.json());
    setListReqStatus(`${res.status}`);
  }, [token]);

  // ---- Create Request (SALES) ----
  const [reqOrderId, setReqOrderId] = useState("");
  const [reqMessage, setReqMessage] = useState("");
  const [reqPayload, setReqPayload] = useState("{}");
  const [createReqResult, setCreateReqResult] = useState<unknown>(null);
  const [createReqStatus, setCreateReqStatus] = useState("");

  const doCreateRequest = useCallback(async () => {
    let payload: unknown;
    try { payload = JSON.parse(reqPayload); } catch { payload = {}; }
    const res = await apiFetch(token, "/api/requests", {
      method: "POST",
      body: JSON.stringify({ orderId: reqOrderId, message: reqMessage, payload }),
    });
    setCreateReqResult(await res.json());
    setCreateReqStatus(`${res.status}`);
  }, [token, reqOrderId, reqMessage, reqPayload]);

  // ---- Update Request (SALES) ----
  const [updateReqId, setUpdateReqId] = useState("");
  const [updateReqMessage, setUpdateReqMessage] = useState("");
  const [updateReqResult, setUpdateReqResult] = useState<unknown>(null);
  const [updateReqStatus, setUpdateReqStatus] = useState("");

  const doUpdateRequest = useCallback(async () => {
    const res = await apiFetch(token, `/api/requests/${updateReqId}`, {
      method: "PUT",
      body: JSON.stringify({ message: updateReqMessage }),
    });
    setUpdateReqResult(await res.json());
    setUpdateReqStatus(`${res.status}`);
  }, [token, updateReqId, updateReqMessage]);

  // ---- Approve Request (ADMIN + SUPERADMIN) ----
  const [approveReqId, setApproveReqId] = useState("");
  const [approveResult, setApproveResult] = useState<unknown>(null);
  const [approveStatus, setApproveStatus] = useState("");

  const doApprove = useCallback(async () => {
    const res = await apiFetch(token, `/api/requests/${approveReqId}/approve`, {
      method: "POST",
    });
    setApproveResult(await res.json());
    setApproveStatus(`${res.status}`);
  }, [token, approveReqId]);

  // ---------------------------------------------------------------------------
  // Role badge colour
  // ---------------------------------------------------------------------------

  const roleBadgeStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
    background: isSales ? "#dcfce7" : isAdmin ? "#dbeafe" : "#f3e8ff",
    color: isSales ? "#166534" : isAdmin ? "#1e40af" : "#6b21a8",
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 800, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>WOMS — API Test UI</h1>

      {/* Token selector */}
      <div style={{
        marginBottom: 24, padding: 12, background: "#f0f4ff", borderRadius: 8,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Acting as:</label>
        <select
          value={token}
          onChange={(e) => setToken(e.target.value)}
          style={{ padding: "4px 8px", fontSize: 13, borderRadius: 4, border: "1px solid #ccc" }}
        >
          {DEV_USERS.map((u) => (
            <option key={u.token} value={u.token}>{u.label}</option>
          ))}
        </select>
        <span style={roleBadgeStyle}>{role}</span>
        <span style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>{token}</span>
      </div>

      {/* Role capability summary */}
      <div style={{ marginBottom: 24, padding: 12, background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", fontSize: 13 }}>
        {isSales && <span>As <strong>SALES</strong>: view orders, create &amp; edit your own orders, submit and edit change requests.</span>}
        {isAdmin && <span>As <strong>ADMIN</strong>: view orders in your group, update order status, delete orders, import CSV, approve requests.</span>}
        {isSuperAdmin && <span>As <strong>SUPERADMIN</strong>: view all orders in your production type, import CSV, approve requests.</span>}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Orders section                                                      */}
      {/* ------------------------------------------------------------------ */}
      <SectionHeading>Orders</SectionHeading>

      {/* 1. List Orders — all roles */}
      <Section title="List Orders — GET /api/orders">
        <Input label="Keyword (optional)" value={listKeyword} onChange={(e) => setListKeyword(e.target.value)} placeholder="search name/type" />
        <Btn onClick={doListOrders}>Send</Btn>
        {listStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {listStatus}</span>}
        <Result data={listResult} />
      </Section>

      {/* 2. Get Order — all roles */}
      <Section title="Get Order — GET /api/orders/:id">
        <Input label="Order ID" value={getOrderId} onChange={(e) => setGetOrderId(e.target.value)} placeholder="order id" />
        <Btn onClick={doGetOrder}>Send</Btn>
        {getStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {getStatus}</span>}
        <Result data={getResult} />
      </Section>

      {/* 3. Create Order — SALES only */}
      {isSales && (
        <Section title="Create Order — POST /api/orders" badge="SALES">
          <Input label="Name" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Order name" />
          <Input label="Type (production group: A/B/C)" value={createType} onChange={(e) => setCreateType(e.target.value)} placeholder="A" />
          <Input label="Due Date" type="date" value={createDueDate} onChange={(e) => setCreateDueDate(e.target.value)} />
          <Input label="Quantity" type="number" value={createQty} onChange={(e) => setCreateQty(e.target.value)} />
          <Btn onClick={doCreateOrder}>Send</Btn>
          {createStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {createStatus}</span>}
          <Result data={createResult} />
        </Section>
      )}

      {/* 4. Update Order — SALES (no status) or ADMIN (with status) */}
      {(isSales || isAdmin) && (
        <Section
          title="Update Order — PUT /api/orders/:id"
          badge={isSales ? "SALES" : "ADMIN"}
        >
          <Input label="Order ID" value={updateId} onChange={(e) => setUpdateId(e.target.value)} placeholder="order id" />
          <Input label="Name" value={updateName} onChange={(e) => setUpdateName(e.target.value)} placeholder="new name (optional)" />
          <Input label="Quantity" type="number" value={updateQty} onChange={(e) => setUpdateQty(e.target.value)} placeholder="new quantity (optional)" />
          {isAdmin && (
            <label style={{ display: "block", marginBottom: 6, fontSize: 13 }}>
              Status (ADMIN only)
              <select
                value={updateStatus2}
                onChange={(e) => setUpdateStatus2(e.target.value)}
                style={{ display: "block", width: "100%", padding: "4px 8px", marginTop: 2, border: "1px solid #ccc", borderRadius: 4, fontSize: 13 }}
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
            <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
              Only works on your own PENDING orders. Status cannot be changed by SALES.
            </p>
          )}
          <Btn onClick={doUpdateOrder}>Send</Btn>
          {updateHttpStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {updateHttpStatus}</span>}
          <Result data={updateResult} />
        </Section>
      )}

      {/* 5. Delete Orders — ADMIN only */}
      {isAdmin && (
        <Section title="Delete Orders — DELETE /api/orders" badge="ADMIN">
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>Soft-deletes (sets status = CANCELLED).</p>
          <Input label="Order IDs (comma-separated)" value={deleteIds} onChange={(e) => setDeleteIds(e.target.value)} placeholder="id1, id2, id3" />
          <Btn onClick={doDeleteOrders}>Send</Btn>
          {deleteStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {deleteStatus}</span>}
          <Result data={deleteResult} />
        </Section>
      )}

      {/* 6. Import CSV — ADMIN + SUPERADMIN */}
      {isAdminOrSuper && (
        <Section title="Import CSV — POST /api/orders/import" badge={isAdmin ? "ADMIN" : "SUPERADMIN"}>
          <p style={{ fontSize: 12, color: "#555", margin: "0 0 8px" }}>
            CSV columns: <code>name,type,dueDate,quantity</code>
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13 }}
          />
          <Btn onClick={doImport}>Send</Btn>
          {importStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {importStatus}</span>}
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
        {listReqStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {listReqStatus}</span>}
        <Result data={listReqResult} />
      </Section>

      {/* 8. Create Request — SALES only */}
      {isSales && (
        <Section title="Create Request — POST /api/requests" badge="SALES">
          <Input label="Order ID" value={reqOrderId} onChange={(e) => setReqOrderId(e.target.value)} placeholder="order id" />
          <Input label="Message" value={reqMessage} onChange={(e) => setReqMessage(e.target.value)} placeholder="reason for request" />
          <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
            Payload (JSON — fields to change on the order)
            <textarea
              value={reqPayload}
              onChange={(e) => setReqPayload(e.target.value)}
              rows={3}
              style={{
                display: "block", width: "100%", padding: "4px 8px", marginTop: 2,
                border: "1px solid #ccc", borderRadius: 4, fontSize: 12,
                fontFamily: "monospace", boxSizing: "border-box",
              }}
            />
          </label>
          <Btn onClick={doCreateRequest}>Send</Btn>
          {createReqStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {createReqStatus}</span>}
          <Result data={createReqResult} />
        </Section>
      )}

      {/* 9. Update Request — SALES only */}
      {isSales && (
        <Section title="Update Request — PUT /api/requests/:id" badge="SALES">
          <Input label="Request ID" value={updateReqId} onChange={(e) => setUpdateReqId(e.target.value)} placeholder="request id" />
          <Input label="New Message" value={updateReqMessage} onChange={(e) => setUpdateReqMessage(e.target.value)} placeholder="updated message" />
          <Btn onClick={doUpdateRequest}>Send</Btn>
          {updateReqStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {updateReqStatus}</span>}
          <Result data={updateReqResult} />
        </Section>
      )}

      {/* 10. Approve Request — ADMIN + SUPERADMIN */}
      {isAdminOrSuper && (
        <Section title="Approve Request — POST /api/requests/:id/approve" badge={isAdmin ? "ADMIN" : "SUPERADMIN"}>
          <p style={{ fontSize: 12, color: "#888", margin: "0 0 8px" }}>
            Applies the request&apos;s payload fields to the linked order.
          </p>
          <Input label="Request ID" value={approveReqId} onChange={(e) => setApproveReqId(e.target.value)} placeholder="request id" />
          <Btn onClick={doApprove}>Send</Btn>
          {approveStatus && <span style={{ marginLeft: 8, fontSize: 12, color: "#555" }}>HTTP {approveStatus}</span>}
          <Result data={approveResult} />
        </Section>
      )}
    </div>
  );
}
