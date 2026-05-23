"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import {
  clearClientAuthSession,
  persistClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type ApiResult = {
  status: number;
  body: unknown;
};

const QUICK_ACCOUNTS = [
  { label: "SuperAdmin A", username: "sa-A", email: "sa-a@mail.shangjung.com" },
  {
    label: "Admin A1",
    username: "admin-A1",
    email: "admin-a1@mail.shangjung.com",
  },
  {
    label: "Sales A",
    username: "sales-A",
    email: "sales-a@mail.shangjung.com",
  },
];

async function parseResponse(response: Response): Promise<ApiResult> {
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("sa-A");
  const [password, setPassword] = useState("Password123!");
  const [showPassword, setShowPassword] = useState(false);
  const session = useClientAuthSession() ?? null;
  const [loading, setLoading] = useState<
    "login" | "logout" | "refresh" | "probe" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [apiResult, setApiResult] = useState<ApiResult | null>(null);

  const roleTone = useMemo(() => {
    switch (session?.user.role) {
      case "SUPERADMIN":
        return { background: "#f3e8ff", color: "#6b21a8", border: "#d8b4fe" };
      case "ADMIN":
        return { background: "#dbeafe", color: "#1e40af", border: "#93c5fd" };
      case "SALES":
        return { background: "#dcfce7", color: "#166534", border: "#86efac" };
      default:
        return { background: "#f3f4f6", color: "#374151", border: "#d1d5db" };
    }
  }, [session?.user.role]);

  const handleLogin = async () => {
    setLoading("login");
    setMessage(null);
    setApiResult(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await parseResponse(response);
      if (!response.ok) {
        setMessage(`Login failed (${result.status})`);
        setApiResult(result);
        return;
      }

      const nextSession = result.body as ClientAuthSession;
      persistClientAuthSession(nextSession);
      router.replace("/visualization/dashboard");
    } finally {
      setLoading(null);
    }
  };

  const handleLogout = async () => {
    setLoading("logout");
    setMessage(null);
    setApiResult(null);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      clearClientAuthSession();
      setMessage("Logged out. Local tokens were cleared.");
    } finally {
      setLoading(null);
    }
  };

  const handleRefresh = async () => {
    if (!session) return;
    setLoading("refresh");
    setMessage(null);
    setApiResult(null);

    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      const result = await parseResponse(response);
      if (!response.ok) {
        clearClientAuthSession();
        setMessage(`Refresh failed (${result.status}). Please log in again.`);
        setApiResult(result);
        return;
      }

      const nextSession = result.body as ClientAuthSession;
      persistClientAuthSession(nextSession);
      setMessage("Token refreshed.");
    } finally {
      setLoading(null);
    }
  };

  const handleProbeUsers = async () => {
    if (!session) return;
    setLoading("probe");
    setMessage(null);

    try {
      const response = await fetch("/api/users", {
        credentials: "same-origin",
      });
      const result = await parseResponse(response);
      setApiResult(result);
      setMessage(
        response.ok
          ? "Protected API allowed this token."
          : "Protected API rejected this token.",
      );
    } finally {
      setLoading(null);
    }
  };

  const fillAccount = (nextUsername: string) => {
    setUsername(nextUsername);
    setPassword("Password123!");
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        color: "#111827",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "flex-start",
            marginBottom: 24,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>
              Wafer Scheduling Auth
            </h1>
            <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>
              Sign in once, then use the issued JWT across protected scheduling
              APIs.
            </p>
          </div>
          {session && (
            <span
              style={{
                ...roleTone,
                border: `1px solid ${roleTone.border}`,
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {session.user.role}
            </span>
          )}
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
            gap: 20,
            alignItems: "start",
          }}
        >
          <section
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 20,
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Login</h2>
            <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 13 }}>
              You can sign in with either your username or email address.
            </p>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              {QUICK_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  onClick={() => fillAccount(account.username)}
                  style={{
                    border: "1px solid #cbd5e1",
                    background:
                      username === account.username ? "#e0f2fe" : "#fff",
                    color: "#0f172a",
                    borderRadius: 6,
                    padding: "7px 9px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {account.label}
                </button>
              ))}
            </div>

            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 12,
              }}
            >
              Username or Email
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="sa-A or sa-a@mail.shangjung.com"
                style={{
                  display: "block",
                  width: "100%",
                  boxSizing: "border-box",
                  marginTop: 6,
                  padding: "10px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
            </label>

            <div
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 16,
              }}
            >
              <label htmlFor="login-password">Password</label>
              <span style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  id="login-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: "0 0 42px",
                    width: 42,
                    height: 42,
                    padding: 0,
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    background: "#fff",
                    color: "#0f172a",
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading !== null}
                style={primaryButtonStyle}
              >
                <LogIn size={16} />
                {loading === "login" ? "Signing in" : "Login"}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loading !== null || !session}
                style={secondaryButtonStyle}
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </section>

          <section
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: 20,
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Session</h2>

            {session ? (
              <div>
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px minmax(0, 1fr)",
                    gap: "8px 14px",
                    margin: 0,
                    fontSize: 13,
                  }}
                >
                  <dt style={termStyle}>Username</dt>
                  <dd style={descStyle}>{session.user.username}</dd>
                  <dt style={termStyle}>Group</dt>
                  <dd style={descStyle}>{session.user.group ?? "-"}</dd>
                  <dt style={termStyle}>Access token</dt>
                  <dd
                    style={{
                      ...descStyle,
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  >
                    Stored in HttpOnly cookie
                  </dd>
                </dl>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginTop: 18,
                  }}
                >
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={loading !== null}
                    style={secondaryButtonStyle}
                  >
                    <RefreshCw size={16} />
                    Refresh token
                  </button>
                  <button
                    type="button"
                    onClick={handleProbeUsers}
                    disabled={loading !== null}
                    style={secondaryButtonStyle}
                  >
                    <ShieldCheck size={16} />
                    Test /api/users
                  </button>
                  <a href="/orders" style={linkButtonStyle}>
                    Orders
                  </a>
                  <a href="/visualization" style={linkButtonStyle}>
                    Visualization
                  </a>
                  <a href="/users" style={linkButtonStyle}>
                    Users
                  </a>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
                No active session. Login to issue tokens and enable protected
                API calls.
              </p>
            )}

            {message && (
              <p
                style={{
                  margin: "18px 0 0",
                  padding: "10px 12px",
                  background: "#f1f5f9",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                {message}
              </p>
            )}

            {apiResult && (
              <pre
                style={{
                  margin: "16px 0 0",
                  maxHeight: 320,
                  overflow: "auto",
                  background: "#0f172a",
                  color: "#dbeafe",
                  borderRadius: 8,
                  padding: 14,
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {JSON.stringify(apiResult, null, 2)}
              </pre>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #0f172a",
  background: "#0f172a",
  color: "#fff",
  borderRadius: 6,
  padding: "10px 13px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  borderRadius: 6,
  padding: "10px 13px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const linkButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#0f172a",
  borderRadius: 6,
  padding: "10px 13px",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
};

const termStyle: React.CSSProperties = {
  color: "#64748b",
  fontWeight: 700,
};

const descStyle: React.CSSProperties = {
  margin: 0,
  color: "#0f172a",
  minWidth: 0,
  overflowWrap: "anywhere",
};
