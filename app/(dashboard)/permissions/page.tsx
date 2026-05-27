"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Mail, RefreshCw, RotateCw, ShieldAlert, UserPlus } from "lucide-react";

import {
  type ClientAuthSession,
  logoutClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type Role = ClientAuthSession["user"]["role"];

type UserRow = {
  id: string;
  username: string | null;
  email: string;
  role: Role;
  group: string | null;
};

type ApiResult = {
  status: number;
  body: unknown;
};

type InviteForm = {
  email: string;
  role: Role;
  group: string;
};

const initialForm: InviteForm = {
  email: "",
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

export default function PermissionsPage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const [items, setItems] = useState<UserRow[]>([]);
  const [form, setForm] = useState<InviteForm>(initialForm);
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [groupFilter, setGroupFilter] = useState<string | "">("");
  const [statusFilter, setStatusFilter] = useState<"" | "ACTIVE" | "PENDING">(
    "",
  );
  const [textFilter, setTextFilter] = useState("");
  const [loading, setLoading] = useState<
    "list" | "invite" | `resend:${string}` | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);

  const isSuperAdmin = session?.user.role === "SUPERADMIN";
  const inviteGroup = form.group.trim() || session?.user.group || "";

  const visibleRoles = useMemo<Role[]>(() => {
    return ["SUPERADMIN", "ADMIN", "SALES"];
  }, []);

  const groupOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.group) s.add(it.group);
    return Array.from(s).sort();
  }, [items]);

  const loadUsers = useCallback(
    async (role?: Role | "") => {
      if (!session) return;

      setLoading((current) => current ?? "list");
      setMessage(null);

      try {
        const url = role
          ? `/api/users?role=${encodeURIComponent(role)}`
          : "/api/users";
        const response = await apiFetch(url);
        const result = await parseResponse(response);
        if (!response.ok) {
          setMessage(`Unable to load users (${result.status})`);
          return;
        }

        const body = result.body as { items?: UserRow[] };
        setItems(body.items ?? []);
      } finally {
        setLoading((current) => (current === "list" ? null : current));
      }
    },
    [session],
  );

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  }, [router]);

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

  const handleInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSuperAdmin) return;

    setLoading("invite");
    setMessage(null);

    try {
      const response = await apiFetch("/api/users", {
        method: "POST",
        body: JSON.stringify({ ...form, group: inviteGroup }),
      });
      const result = await parseResponse(response);
      if (!response.ok) {
        setMessage(`Invitation failed (${result.status})`);
        return;
      }

      // show a user-facing alert and optimistic list update
      window.alert(`Invitation sent to ${form.email}.`);

      // attempt to extract created user from response body
      const created = result.body as
        | {
            id: string;
            email: string;
            role: Role;
            group: string;
            invitationExpiresAt?: string;
          }
        | undefined;

      // reset the form
      setForm({ ...initialForm, group: session?.user.group ?? "" });

      // ensure the newly invited user appears in the list even if username is null
      if (created && created.id) {
        setItems((current) => {
          if (current.find((u) => u.id === created.id)) return current;
          const nu: UserRow = {
            id: created.id,
            email: created.email,
            username: null,
            role: created.role,
            group: created.group ?? inviteGroup,
          };
          return [nu, ...current];
        });
      }

      // refresh from server to get authoritative list (non-blocking)
      void loadUsers();
    } finally {
      setLoading(null);
    }
  };

  const handleResend = async (user: UserRow) => {
    if (!isSuperAdmin) return;

    setLoading(`resend:${user.id}`);
    setMessage(null);

    try {
      const response = await apiFetch(
        `/api/users/${encodeURIComponent(user.id)}/invitation/resend`,
        { method: "POST" },
      );
      const result = await parseResponse(response);
      if (!response.ok) {
        setMessage(`Resend failed (${result.status})`);
        return;
      }

      window.alert(`Invitation resent to ${user.email}.`);
      setMessage(`Invitation resent to ${user.email}.`);
      await loadUsers();
    } finally {
      setLoading(null);
    }
  };

  const filtered = items.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (groupFilter && (u.group ?? "") !== groupFilter) return false;
    const pending = !u.username;
    if (statusFilter === "PENDING" && !pending) return false;
    if (statusFilter === "ACTIVE" && pending) return false;
    if (textFilter) {
      const t = textFilter.toLowerCase();
      return (
        (u.email && u.email.toLowerCase().includes(t)) ||
        (u.username && u.username.toLowerCase().includes(t))
      );
    }
    return true;
  });

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

  if (!isSuperAdmin) {
    return (
      <main style={pageStyle}>
        <header style={topBarStyle}>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 750 }}>
              Permissions
            </h1>
            <p style={{ margin: "4px 0 0", color: "#475569", fontSize: 13 }}>
              Access restricted to SUPERADMIN.
            </p>
          </div>
        </header>
        <section style={warningStyle}>
          <ShieldAlert size={18} />
          <span>You do not have permission to view this page.</span>
        </section>
      </main>
    );
  }

  return (
    <DashboardShell
      title="Permissions"
      subtitle="Manage user accounts and roles."
      onBack={handleLogout}
      leftSectionSurfaceClassName="flex flex-col bg-transparent rounded-none border-0 shadow-none overflow-hidden"
      leftSection={
        <>
          <section style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Add User</h2>
                <p style={sectionMetaStyle}>Quickly invite a new account.</p>
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
                  {loading === "invite" ? "Sending..." : "Add User"}
                </button>
              </div>
            </form>
          </section>

          <section style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>User List</h2>
                <p style={sectionMetaStyle}>
                  Filter and manage existing accounts.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  placeholder="Search email or username"
                  value={textFilter}
                  onChange={(e) => setTextFilter(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                  }}
                />
                <button
                  type="button"
                  onClick={() => loadUsers(roleFilter)}
                  disabled={loading === "list"}
                  style={secondaryButtonStyle}
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Username</th>
                    <th style={thStyle}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <span>Role</span>
                        <select
                          value={roleFilter}
                          onChange={(e) => {
                            const val = e.target.value as Role | "";
                            setRoleFilter(val);
                            void loadUsers(val);
                          }}
                          style={{
                            padding: "5px 8px",
                            fontSize: 13,
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">All roles</option>
                          {visibleRoles.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                    <th style={thStyle}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <span>Group</span>
                        <select
                          value={groupFilter}
                          onChange={(e) => setGroupFilter(e.target.value)}
                          style={{
                            padding: "5px 8px",
                            fontSize: 13,
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">All groups</option>
                          {groupOptions.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>
                    </th>
                    <th style={thStyle}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <span>Status</span>
                        <select
                          value={statusFilter}
                          onChange={(e) =>
                            setStatusFilter(
                              e.target.value as "" | "ACTIVE" | "PENDING",
                            )
                          }
                          style={{
                            padding: "5px 8px",
                            fontSize: 13,
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            background: "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <option value="">All</option>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="PENDING">PENDING</option>
                        </select>
                      </div>
                    </th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const pending = !user.username;
                    const resendLoading = loading === `resend:${user.id}`;
                    return (
                      <tr key={user.id} style={trStyle}>
                        <td style={tdStyle}>{user.email}</td>
                        <td style={tdStyle}>{user.username ?? "-"}</td>
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
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ ...tdStyle, color: "#475569" }}>
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {message && <p style={messageStyle}>{message}</p>}
        </>
      }
      rightSection={<></>}
      hideRightSection={true}
    />
  );
}

// reuse same styles as users page
const pageStyle: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 1040,
  minHeight: "100vh",
  margin: "0 auto",
  padding: 24,
  color: "#0f172a",
  background: "#f8fafc",
  boxShadow: "0 0 0 100vmax #f8fafc",
  clipPath: "inset(0 -100vmax)",
};

const topBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

const panelStyle: React.CSSProperties = {
  border: "1px solid #dbe3ef",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  background: "#ffffff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
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
  color: "#475569",
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
  color: "#334155",
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
  color: "#1e293b",
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
  color: "#1e293b",
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
  color: "#334155",
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
  background: "#f1f5f9",
  borderRadius: 8,
  padding: 12,
  margin: "0 0 16px",
  color: "#1e293b",
  fontSize: 13,
};

const mutedTextStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 14,
};
