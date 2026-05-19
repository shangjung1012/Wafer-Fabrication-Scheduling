"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  logoutClientAuthSession,
  persistClientAuthSession,
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

const cardStyle: React.CSSProperties = {
  border: "1px solid #dbe3ef",
  borderRadius: 8,
  padding: 20,
  marginBottom: 20,
  background: "#ffffff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 13,
  color: "#334155",
  fontWeight: 650,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "6px 10px",
  marginTop: 2,
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
  boxSizing: "border-box",
};

const EMAIL_ERROR_MESSAGES: Record<string, string> = {
  missing_token: "Verification link is invalid (missing token).",
  invalid_token: "Verification link is invalid or has already been used.",
  already_used: "This verification link has already been used.",
  expired: "Verification link has expired. Please request a new one.",
  email_taken:
    "That email address was taken by another account before you could confirm. Please try again.",
};

function roleBadge(role: Role): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 700,
    padding: "3px 10px",
    borderRadius: 99,
    background:
      role === "SALES" ? "#dcfce7" : role === "ADMIN" ? "#dbeafe" : "#f3e8ff",
    color:
      role === "SALES" ? "#166534" : role === "ADMIN" ? "#1e40af" : "#6b21a8",
  };
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfilePageInner />
    </Suspense>
  );
}

function ProfilePageInner() {
  const session = useClientAuthSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionRefreshed = useRef(false);

  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [emailStatus, setEmailStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(() => {
    // Read ?emailError on first render so no setState-in-effect is needed
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const emailError = params.get("emailError");
    if (!emailError) return null;
    const url = new URL(window.location.href);
    url.searchParams.delete("emailError");
    window.history.replaceState({}, "", url.toString());
    return {
      ok: false,
      message: EMAIL_ERROR_MESSAGES[emailError] ?? "Email verification failed.",
    };
  });
  const [emailLoading, setEmailLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);

  // On mount: handle ?emailUpdated=true — fetch fresh user data then update localStorage
  useEffect(() => {
    if (sessionRefreshed.current) return;
    if (searchParams.get("emailUpdated") !== "true") return;

    sessionRefreshed.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("emailUpdated");
    window.history.replaceState({}, "", url.toString());

    apiFetch("/api/users/me")
      .then((res) => res.json())
      .then((data: { user?: ClientAuthSession["user"] }) => {
        if (data.user) persistClientAuthSession({ user: data.user });
        setEmailStatus({ ok: true, message: "Email updated successfully." });
      })
      .catch(() => {
        setEmailStatus({ ok: true, message: "Email updated successfully." });
      });
  }, [searchParams]);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) router.replace("/login");
  }, [session, router]);

  const handleEmailChange = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setEmailLoading(true);
      setEmailStatus(null);
      try {
        const res = await apiFetch("/api/users/me/request-email-change", {
          method: "POST",
          body: JSON.stringify({ newEmail, currentPassword }),
        });
        const json = (await res.json()) as { message?: string; code?: string };
        if (res.ok) {
          setPendingVerification(true);
          setNewEmail("");
          setCurrentPassword("");
          setEmailStatus({
            ok: true,
            message:
              json.message ??
              "Verification email sent. Check your new inbox — the link expires in 3 minutes.",
          });
        } else {
          setEmailStatus({
            ok: false,
            message: json.message ?? `Error ${res.status}`,
          });
        }
      } catch {
        setEmailStatus({ ok: false, message: "Network error." });
      } finally {
        setEmailLoading(false);
      }
    },
    [newEmail, currentPassword],
  );

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  }, [router]);

  if (session === undefined)
    return <div style={pageShellStyle}>Loading...</div>;
  if (session === null) return <div style={pageShellStyle}>Redirecting...</div>;

  const { user } = session;

  return (
    <div style={pageShellStyle}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        WOMS — Profile
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
        <a href="/conflict-issues" style={navLinkStyle}>
          Conflicts
        </a>
        <a href="/visualization" style={navLinkStyle}>
          Visualization
        </a>
        <a href="/users" style={navLinkStyle}>
          Users
        </a>
        <a
          href="/profile"
          style={{
            ...navLinkStyle,
            background: "#f0f4ff",
            borderColor: "#93c5fd",
          }}
        >
          Profile
        </a>
      </nav>

      {/* Current user info */}
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
        <strong style={{ fontSize: 13 }}>{user.username}</strong>
        <span style={{ fontSize: 12, color: "#334155" }}>({user.email})</span>
        <span style={roleBadge(user.role)}>{user.role}</span>
        {user.group && (
          <span style={{ fontSize: 12, color: "#334155" }}>
            Group {user.group}
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

      {/* Change Email */}
      <div style={cardStyle}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>
          Change Email
        </h2>
        <p style={{ fontSize: 13, color: "#475569", margin: "0 0 14px" }}>
          Current email: <strong>{user.email}</strong>
        </p>

        {pendingVerification ? (
          <div
            style={{
              fontSize: 13,
              color: "#1e40af",
              background: "#dbeafe",
              padding: "10px 14px",
              borderRadius: 6,
            }}
          >
            <strong>Check your new inbox.</strong> We sent a verification link
            to <strong>{newEmail || "your new address"}</strong>. The link
            expires in <strong>3 minutes</strong>.{" "}
            <button
              type="button"
              onClick={() => {
                setPendingVerification(false);
                setEmailStatus(null);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#1e40af",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: 13,
                padding: 0,
              }}
            >
              Request a new link
            </button>
          </div>
        ) : (
          <form onSubmit={handleEmailChange}>
            <label style={labelStyle}>
              New Email
              <input
                style={inputStyle}
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="new@example.com"
                required
              />
            </label>
            <label style={{ ...labelStyle, marginTop: 10 }}>
              Current Password
              <input
                style={inputStyle}
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="your current password"
                required
              />
            </label>
            <button
              type="submit"
              disabled={emailLoading}
              style={{
                marginTop: 14,
                padding: "7px 18px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 6,
                border: "none",
                background: emailLoading ? "#94a3b8" : "#2563eb",
                color: "#fff",
                cursor: emailLoading ? "not-allowed" : "pointer",
              }}
            >
              {emailLoading ? "Sending…" : "Request Email Change"}
            </button>
          </form>
        )}

        {emailStatus && (
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              color: emailStatus.ok ? "#166534" : "#991b1b",
              background: emailStatus.ok ? "#dcfce7" : "#fee2e2",
              padding: "6px 10px",
              borderRadius: 6,
            }}
          >
            {emailStatus.message}
          </p>
        )}
      </div>
    </div>
  );
}
