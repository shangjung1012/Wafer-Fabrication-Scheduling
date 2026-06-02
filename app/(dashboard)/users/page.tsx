"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import Link from "next/link";
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
import {
  RoleBadge,
  StatusBadge,
  fieldStyle,
  formGridStyle,
  iconButtonStyle,
  inputStyle,
  labelStyle,
  mutedTextStyle,
  pageStyle,
  panelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionHeaderStyle,
  sectionMetaStyle,
  sectionTitleStyle,
  tableStyle,
  tdStyle,
  thStyle,
  topBarStyle,
  trStyle,
  warningStyle,
} from "@/components/users/user-admin-ui";

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
      ...options.headers,
    },
  });
}

export default function UsersPage() {
  const router = useRouter();
  const session = useClientAuthSession();
  const [items, setItems] = useState<UserRow[]>([]);
  const [form, setForm] = useState<InviteForm>(initialForm);
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
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
    },
    [session],
  );

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
          <p style={{ margin: "4px 0 0", color: "#475569", fontSize: 13 }}>
            Invite account owners and monitor pending setup status.
          </p>
        </div>

        <nav style={navStyle} aria-label="Dashboard navigation">
          <a href="/orders" style={navLinkStyle}>
            Orders
          </a>
          <Link href="/conflict-issues" style={navLinkStyle}>
            Issues
          </Link>
          <a href="/visualization" style={navLinkStyle}>
            Schedule
          </a>
          <a href="/users" style={{ ...navLinkStyle, ...activeNavLinkStyle }}>
            Users
          </a>
          <a href="/profile" style={navLinkStyle}>
            Profile
          </a>
        </nav>
      </header>

      <section style={sessionBarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={16} />
          <strong style={{ fontSize: 13 }}>{session.user.username}</strong>
          <RoleBadge role={session.user.role} />
          {session.user.group && (
            <span style={{ color: "#475569", fontSize: 12 }}>
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
              Pending means the recipient has not set a username and password.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              <option value="SUPERADMIN">SUPERADMIN</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SALES">SALES</option>
            </select>
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
                {["Email", "Username", "Role", "Group", "Status", ""].map(
                  (heading) => (
                    <th key={heading} style={thStyle}>
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((user) => {
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
              {items.length === 0 && (
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
      {apiResult && (
        <pre style={resultStyle}>{JSON.stringify(apiResult, null, 2)}</pre>
      )}
    </main>
  );
}

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
  color: "#1e293b",
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
  background: "#f1f5f9",
  borderRadius: 8,
  padding: 12,
  marginBottom: 16,
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

const resultStyle: React.CSSProperties = {
  border: "1px solid #dbe3ef",
  background: "#f1f5f9",
  borderRadius: 8,
  padding: 12,
  margin: 0,
  color: "#1e293b",
  fontSize: 12,
  overflowX: "auto",
  maxHeight: 260,
};
