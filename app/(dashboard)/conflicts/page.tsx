"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  logoutClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type Role = ClientAuthSession["user"]["role"];

type ConflictOrder = {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string;
  quantity: number;
  applicantId: string;
  applicantUsername: string | null;
  applicantEmail: string;
  lastModifiedById: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
};

function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const pageShell: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 900,
  minHeight: "100vh",
  margin: "0 auto",
  padding: 24,
  color: "#0f172a",
  background: "#f8fafc",
  boxShadow: "0 0 0 100vmax #f8fafc",
  clipPath: "inset(0 -100vmax)",
};

const navLink: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "7px 11px",
  color: "#334155",
  background: "#fff",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 650,
};

const activeNavLink: React.CSSProperties = {
  ...navLink,
  background: "#ef4444",
  color: "#fff",
  border: "1px solid #ef4444",
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ConflictsPage() {
  const router = useRouter();
  const session = useClientAuthSession();

  const role: Role | undefined = session?.user.role;
  const isSales = role === "SALES";

  const [conflicts, setConflicts] = useState<ConflictOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [router, session]);

  const fetchConflicts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/conflicts");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `Error ${res.status}`);
        return;
      }
      setConflicts(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetchConflicts();
  }, [session, fetchConflicts]);

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  }, [router]);

  if (session === undefined) return <div style={pageShell}>Loading…</div>;
  if (session === null) return <div style={pageShell}>Redirecting…</div>;

  const roleBadge: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    padding: "3px 10px",
    borderRadius: 99,
    background: isSales ? "#dcfce7" : "#dbeafe",
    color: isSales ? "#166534" : "#1e40af",
  };

  return (
    <div style={pageShell}>
      {/* Header */}
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        WOMS — Conflict Resolution
      </h1>

      {/* Nav */}
      <nav
        aria-label="Dashboard navigation"
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          margin: "12px 0 18px",
        }}
      >
        <a href="/orders" style={navLink}>
          Orders
        </a>
        <a href="/conflicts" style={activeNavLink}>
          Conflicts
        </a>
        <a href="/visualization" style={navLink}>
          Visualization
        </a>
        <a href="/users" style={navLink}>
          Users
        </a>
        <a href="/profile" style={navLink}>
          Profile
        </a>
      </nav>

      {/* Session bar */}
      <div
        style={{
          marginBottom: 24,
          padding: 12,
          background: "#f0f4ff",
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
        <span style={roleBadge}>{role}</span>
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
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>

      {/* Page title + refresh */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
            Conflict Orders
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
            {isSales
              ? "Your orders that were kicked out by the scheduler. Add a proposal or comment for the admin."
              : "Orders that failed scheduling and need manual resolution or rescheduling."}
          </p>
        </div>
        <button
          type="button"
          onClick={fetchConflicts}
          disabled={loading}
          style={{
            padding: "7px 14px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Conflict list */}
      {conflicts === null && !loading && !error ? null : conflicts?.length ===
        0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe3ef",
            borderRadius: 8,
            padding: 32,
            textAlign: "center",
            color: "#64748b",
            fontSize: 14,
          }}
        >
          No conflict orders. All clear!
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(conflicts ?? []).map((c) => (
            <ConflictCard
              key={c.id}
              conflict={c}
              onClick={() => router.push(`/conflicts/${c.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conflict card
// ---------------------------------------------------------------------------

function ConflictCard({
  conflict,
  onClick,
}: {
  conflict: ConflictOrder;
  onClick: () => void;
}) {
  const due = new Date(conflict.dueDate).toLocaleDateString("en-CA");

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "#fff",
        border: "1px solid #fca5a5",
        borderLeft: "4px solid #ef4444",
        borderRadius: 8,
        padding: "14px 16px",
        cursor: "pointer",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        transition: "box-shadow 0.1s",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Icon */}
        <div
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#fee2e2",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
          }}
        >
          ⚠
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
              {conflict.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 99,
                background: "#fee2e2",
                color: "#991b1b",
              }}
            >
              CONFLICT
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 99,
                background: "#f1f5f9",
                color: "#475569",
              }}
            >
              Type {conflict.type}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: 6,
              fontSize: 12,
              color: "#64748b",
              flexWrap: "wrap",
            }}
          >
            <span>
              Qty:{" "}
              <strong style={{ color: "#0f172a" }}>
                {conflict.quantity.toLocaleString()}
              </strong>
            </span>
            <span>
              Due: <strong style={{ color: "#0f172a" }}>{due}</strong>
            </span>
            <span>
              By:{" "}
              <strong style={{ color: "#0f172a" }}>
                {conflict.applicantUsername ?? conflict.applicantEmail}
              </strong>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              💬 {conflict.commentCount} comment
              {conflict.commentCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <div style={{ color: "#94a3b8", fontSize: 18, alignSelf: "center" }}>
          ›
        </div>
      </div>
    </button>
  );
}
