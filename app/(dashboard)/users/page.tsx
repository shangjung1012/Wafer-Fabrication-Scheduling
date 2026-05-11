"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  Mail,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  UserPlus,
  Users,
} from "lucide-react";

import {
  logoutClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type Role = ClientAuthSession["user"]["role"];

type UserRow = {
  id: string;
  accountId: string | null;
  email: string;
  name: string;
  role: Role;
  group: string | null;
};

type ApiResult = {
  status: number;
  body: unknown;
};

type InviteForm = {
  email: string;
  name: string;
  role: Role;
  group: string;
};

const initialForm: InviteForm = {
  email: "",
  name: "",
  role: "SALES",
  group: "",
};

function roleTone(role: Role): {
  background: string;
  color: string;
  border: string;
} {
  switch (role) {
    case "SUPERADMIN":
      return { background: "#f3e8ff", color: "#6b21a8", border: "#d8b4fe" };
    case "ADMIN":
      return { background: "#dbeafe", color: "#1e40af", border: "#93c5fd" };
    case "SALES":
      return { background: "#dcfce7", color: "#166534", border: "#86efac" };
  }
}

async function parseResponse(response: Response): Promise<ApiResult> {
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

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

function RoleBadge({ role }: { role: Role }) {
  const tone = roleTone(role);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {role}
    </span>
  );
}

function StatusBadge({ pending }: { pending: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${pending ? "#fed7aa" : "#bbf7d0"}`,
        background: pending ? "#fff7ed" : "#f0fdf4",
        color: pending ? "#9a3412" : "#166534",
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {pending ? "PENDING" : "ACTIVE"}
    </span>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const [items, setItems] = useState<UserRow[]>([]);
  const [form, setForm] = useState<InviteForm>(initialForm);
  const [loading, setLoading] = useState<
    "list" | "invite" | `resend:${string}` | "logout" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [apiResult, setApiResult] = useState<ApiResult | null>(null);

  const isSuperAdmin = session?.user.role === "SUPERADMIN";
  const inviteGroup = form.group.trim() || session?.user.group || "";

  const visibleRoles = useMemo<Role[]>(() => {
    return ["SUPERADMIN", "ADMIN", "SALES"];
  }, []);

  const loadUsers = useCallback(async () => {
    if (!session) return;

    setLoading((current) => current ?? "list");
    setMessage(null);

    try {
      const response = await apiFetch("/api/users");
      const result = await parseResponse(response);
      setApiResult(result);
      if (!response.ok) {
        setMessage(`Unable to load users (${result.status})`);
        return;
      }

      const body = result.body as { items?: UserRow[] };
      setItems(body.items ?? []);
    } finally {
      setLoading((current) => (current === "list" ? null : current));
    }
  }, [session]);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      router.replace("/login");
      return;
    }
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers, router, session]);

  const handleLogout = async () => {
    setLoading("logout");
    await logoutClientAuthSession();
    router.replace("/login");
  };

  const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSuperAdmin) return;

    setLoading("invite");
    setMessage(null);
    setApiResult(null);

    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({ ...form, group: inviteGroup }),
      });
      const result = await parseResponse(response);
      setApiResult(result);
      if (!response.ok) {
        setMessage(`Invitation failed (${result.status})`);
        return;
      }

      setMessage(`Invitation sent to ${form.email}.`);
      setForm({
        ...initialForm,
        group: session?.user.group ?? "",
      });
      await loadUsers();
    } finally {
      setLoading(null);
    }
  };

  const handleResend = async (user: UserRow) => {
    if (!isSuperAdmin) return;

    setLoading(`resend:${user.id}`);
    setMessage(null);
    setApiResult(null);

    try {
      const response = await apiFetch(
        `/api/users/${encodeURIComponent(user.id)}/invitation/resend`,
        { method: "POST" },
      );
      const result = await parseResponse(response);
      setApiResult(result);
      if (!response.ok) {
        setMessage(`Resend failed (${result.status})`);
        return;
      }

      setMessage(`Invitation resent to ${user.email}.`);
      await loadUsers();
    } finally {
      setLoading(null);
    }
  };

  if (session === undefined) {
    return (
      <main style={pageStyle}>
        <p style={mutedTextStyle}>Loading session...</p>
      </main>
    );
  }

  if (session === null) {
    return (
      <main style={pageStyle}>
        <p style={mutedTextStyle}>Redirecting to login...</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <header style={topBarStyle}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>
            User Invitations
          </h1>
          <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
            Invite account owners and monitor pending setup status.
          </p>
        </div>

        <nav style={navStyle} aria-label="Dashboard navigation">
          <a href="/orders" style={navLinkStyle}>
            Orders
          </a>
          <a href="/visualization" style={navLinkStyle}>
            Visualization
          </a>
          <a href="/users" style={{ ...navLinkStyle, ...activeNavLinkStyle }}>
            Users
          </a>
        </nav>
      </header>

      <section style={sessionBarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={16} />
          <strong style={{ fontSize: 13 }}>{session.user.name}</strong>
          <span style={{ color: "#64748b", fontSize: 12 }}>
            {session.user.accountId}
          </span>
          <RoleBadge role={session.user.role} />
          {session.user.group && (
            <span style={{ color: "#64748b", fontSize: 12 }}>
              Group {session.user.group}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loading === "logout"}
          style={secondaryButtonStyle}
        >
          <LogOut size={15} />
          Logout
        </button>
      </section>

      {!isSuperAdmin && (
        <section style={warningStyle}>
          <ShieldAlert size={18} />
          <span>
            Your role can list scoped users, but only SUPERADMIN can create or
            resend invitations.
          </span>
        </section>
      )}

      {isSuperAdmin && (
        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Invite User</h2>
              <p style={sectionMetaStyle}>
                The recipient will receive a 180-second set-password link.
              </p>
            </div>
            <Mail size={18} color="#475569" />
          </div>

          <form onSubmit={handleInvite} style={formGridStyle}>
            <label style={fieldStyle}>
              <span style={labelStyle}>Email</span>
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="person@example.com"
                style={inputStyle}
              />
            </label>

            <label style={fieldStyle}>
              <span style={labelStyle}>Name</span>
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Display name"
                style={inputStyle}
              />
            </label>

            <label style={fieldStyle}>
              <span style={labelStyle}>Role</span>
              <select
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value as Role,
                  }))
                }
                style={inputStyle}
              >
                {visibleRoles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldStyle}>
              <span style={labelStyle}>Group</span>
              <input
                required
                value={form.group || session.user.group || ""}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    group: event.target.value,
                  }))
                }
                placeholder="A"
                style={inputStyle}
              />
            </label>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                type="submit"
                disabled={loading === "invite"}
                style={primaryButtonStyle}
              >
                <UserPlus size={16} />
                {loading === "invite" ? "Sending..." : "Send Invite"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section style={panelStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Users</h2>
            <p style={sectionMetaStyle}>
              Pending means the recipient has not set an account ID and
              password.
            </p>
          </div>
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading === "list"}
            style={secondaryButtonStyle}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {[
                  "Name",
                  "Email",
                  "Account",
                  "Role",
                  "Group",
                  "Status",
                  "",
                ].map((heading) => (
                  <th key={heading} style={thStyle}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((user) => {
                const pending = !user.accountId;
                const resendLoading = loading === `resend:${user.id}`;
                return (
                  <tr key={user.id} style={trStyle}>
                    <td style={tdStyle}>
                      <strong>{user.name}</strong>
                    </td>
                    <td style={tdStyle}>{user.email}</td>
                    <td style={tdStyle}>{user.accountId ?? "-"}</td>
                    <td style={tdStyle}>
                      <RoleBadge role={user.role} />
                    </td>
                    <td style={tdStyle}>{user.group ?? "-"}</td>
                    <td style={tdStyle}>
                      <StatusBadge pending={pending} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {isSuperAdmin && pending ? (
                        <button
                          type="button"
                          onClick={() => handleResend(user)}
                          disabled={resendLoading}
                          style={iconButtonStyle}
                          title="Resend invitation"
                        >
                          <RotateCw size={14} />
                          {resendLoading ? "Sending" : "Resend"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, color: "#64748b" }}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {message && <p style={messageStyle}>{message}</p>}
      {apiResult && (
        <pre style={resultStyle}>{JSON.stringify(apiResult, null, 2)}</pre>
      )}
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 1040,
  margin: "0 auto",
  padding: 24,
  color: "#0f172a",
};

const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

const navStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
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

const activeNavLinkStyle: React.CSSProperties = {
  borderColor: "#93c5fd",
  background: "#eff6ff",
  color: "#1d4ed8",
};

const sessionBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  border: "1px solid #dbe3ef",
  background: "#f8fafc",
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
};

const panelStyle: React.CSSProperties = {
  border: "1px solid #dbe3ef",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  background: "#fff",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 750,
};

const sectionMetaStyle: React.CSSProperties = {
  margin: "4px 0 0",
  color: "#64748b",
  fontSize: 12,
};

const formGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  alignItems: "end",
};

const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 12,
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 14,
  color: "#0f172a",
  background: "#fff",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 38,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: "1px solid #2563eb",
  borderRadius: 6,
  padding: "8px 12px",
  background: "#2563eb",
  color: "#fff",
  fontSize: 13,
  fontWeight: 750,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "6px 10px",
  background: "#fff",
  color: "#334155",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

const iconButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  padding: "5px 9px",
  background: "#fff",
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const warningStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid #fed7aa",
  background: "#fff7ed",
  color: "#9a3412",
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
  fontSize: 13,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid #dbe3ef",
  padding: "9px 10px",
  color: "#475569",
  fontSize: 12,
  fontWeight: 750,
  textAlign: "left",
  whiteSpace: "nowrap",
};

const trStyle: React.CSSProperties = {
  borderBottom: "1px solid #eef2f7",
};

const tdStyle: React.CSSProperties = {
  padding: "10px",
  verticalAlign: "middle",
  color: "#0f172a",
  whiteSpace: "nowrap",
};

const messageStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  borderRadius: 8,
  padding: 12,
  margin: "0 0 16px",
  color: "#334155",
  fontSize: 13,
};

const resultStyle: React.CSSProperties = {
  border: "1px solid #dbe3ef",
  background: "#f8fafc",
  borderRadius: 8,
  padding: 12,
  margin: 0,
  color: "#334155",
  fontSize: 12,
  overflowX: "auto",
  maxHeight: 260,
};

const mutedTextStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 14,
};
