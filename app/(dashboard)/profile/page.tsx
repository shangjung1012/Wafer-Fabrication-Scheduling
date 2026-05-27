"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  persistClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { AppHeader } from "@/components/dashboard/AppHeader";

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
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const emailError = params.get("emailError");
    if (!emailError) return null;
    return {
      ok: false,
      message: EMAIL_ERROR_MESSAGES[emailError] ?? "Email verification failed.",
    };
  });
  const [emailConfirmToken, setEmailConfirmToken] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      const params = new URLSearchParams(window.location.search);
      const token = params.get("emailChangeToken");
      if (!token) return null;
      return token;
    },
  );
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailConfirmLoading, setEmailConfirmLoading] = useState(false);
  const [pendingVerification, setPendingVerification] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["emailError", "emailChangeToken"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) window.history.replaceState({}, "", url.toString());
  }, []);

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

  const handleConfirmEmailChange = useCallback(async () => {
    if (!emailConfirmToken) return;
    setEmailConfirmLoading(true);
    setEmailStatus(null);
    try {
      const res = await apiFetch("/api/users/me/verify-email", {
        method: "POST",
        body: JSON.stringify({ token: emailConfirmToken }),
      });
      const json = (await res.json()) as { message?: string; code?: string };
      if (!res.ok) {
        setEmailStatus({
          ok: false,
          message: json.message ?? `Error ${res.status}`,
        });
        return;
      }

      const meRes = await apiFetch("/api/users/me");
      const me = (await meRes.json()) as { user?: ClientAuthSession["user"] };
      if (me.user) persistClientAuthSession({ user: me.user });

      setEmailConfirmToken(null);
      setPendingVerification(false);
      setEmailStatus({
        ok: true,
        message: json.message ?? "Email updated successfully.",
      });
    } catch {
      setEmailStatus({ ok: false, message: "Network error." });
    } finally {
      setEmailConfirmLoading(false);
    }
  }, [emailConfirmToken]);

  if (!session)
    return (
      <div className="p-10 text-center text-sm text-gray-400">Loading…</div>
    );

  const { user } = session;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 font-sans">
      <AppHeader title="Profile" subtitle="Manage your account settings" />
      <div
        style={{ maxWidth: 800, margin: "0 auto", width: "100%", padding: 24 }}
      >
        {/* Change Email */}
        <div style={cardStyle}>
          <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700 }}>
            Change Email
          </h2>
          <p style={{ fontSize: 13, color: "#475569", margin: "0 0 14px" }}>
            Current email: <strong>{user.email}</strong>
          </p>

          {emailConfirmToken ? (
            <div
              style={{
                fontSize: 13,
                color: "#0f172a",
                background: "#f8fafc",
                padding: "10px 14px",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
              }}
            >
              <strong>Confirm email change</strong>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleConfirmEmailChange}
                  disabled={emailConfirmLoading}
                  style={{
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "none",
                    background: emailConfirmLoading ? "#94a3b8" : "#2563eb",
                    color: "#fff",
                    cursor: emailConfirmLoading ? "not-allowed" : "pointer",
                  }}
                >
                  {emailConfirmLoading ? "Confirming..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setEmailConfirmToken(null)}
                  disabled={emailConfirmLoading}
                  style={{
                    padding: "6px 14px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#334155",
                    cursor: emailConfirmLoading ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : pendingVerification ? (
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
    </div>
  );
}
