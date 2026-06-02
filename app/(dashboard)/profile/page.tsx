"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  logoutClientAuthSession,
  persistClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

type Role = ClientAuthSession["user"]["role"];

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

const pageShellStyle: React.CSSProperties = {
  maxWidth: 1000,
  margin: "0 auto",
  padding: "20px 16px",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: "#0f172a",
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

const EMAIL_ERROR_MESSAGES: Record<string, string> = {
  missing_token: "Verification link is invalid (missing token).",
  invalid_token: "Verification link is invalid or has already been used.",
  already_used: "This verification link has already been used.",
  expired: "Verification link has expired. Please request a new one.",
  email_taken:
    "That email address was taken by another account before you could confirm. Please try again.",
};

function roleBadge(role: Role): React.CSSProperties {
  let bg = "#f3e8ff";
  if (role === "SALES") {
    bg = "#dcfce7";
  } else if (role === "ADMIN") {
    bg = "#dbeafe";
  }

  let color = "#6b21a8";
  if (role === "SALES") {
    color = "#166534";
  } else if (role === "ADMIN") {
    color = "#1e40af";
  }

  return {
    fontSize: 12,
    fontWeight: 700,
    padding: "3px 10px",
    borderRadius: 99,
    background: bg,
    color,
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

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  }, [router]);

  if (session === undefined)
    return <div style={pageShellStyle}>Loading...</div>;
  if (session === null) return <div style={pageShellStyle}>Redirecting...</div>;

  const { user } = session;

  return (
    <DashboardShell
      title="Profile"
      subtitle="Manage your account and email."
      leftSectionSurfaceClassName="flex flex-col bg-transparent rounded-none border-0 shadow-none overflow-hidden"
      leftSection={
        <>
          <section style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Current User</h2>
                <p style={sectionMetaStyle}>Signed-in account details.</p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gap: 8,
                padding: 12,
                borderRadius: 8,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{ minWidth: 72, color: "#64748b", fontWeight: 700 }}
                >
                  Name:
                </span>
                <strong style={{ color: "#0f172a" }}>{user.username}</strong>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{ minWidth: 72, color: "#64748b", fontWeight: 700 }}
                >
                  Email:
                </span>
                <span style={{ color: "#0f172a" }}>{user.email}</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{ minWidth: 72, color: "#64748b", fontWeight: 700 }}
                >
                  Role:
                </span>
                <span style={roleBadge(user.role)}>{user.role}</span>
              </div>
              {user.group && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{ minWidth: 72, color: "#64748b", fontWeight: 700 }}
                  >
                    Group:
                  </span>
                  <span style={{ color: "#0f172a" }}>Group {user.group}</span>
                </div>
              )}
            </div>
          </section>

          <section style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Change Email</h2>
                <p style={sectionMetaStyle}>
                  Current email: <strong>{user.email}</strong>
                </p>
              </div>
            </div>

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
                    style={
                      emailConfirmLoading
                        ? {
                            ...primaryButtonStyle,
                            background: "#94a3b8",
                            borderColor: "#94a3b8",
                            cursor: "not-allowed",
                          }
                        : primaryButtonStyle
                    }
                  >
                    {emailConfirmLoading ? "Confirming..." : "Confirm"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEmailConfirmToken(null)}
                    disabled={emailConfirmLoading}
                    style={secondaryButtonStyle}
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
                <strong>Check your new inbox.</strong> We sent a verification
                link to <strong>{newEmail || "your new address"}</strong>. The
                link expires in <strong>3 minutes</strong>.{" "}
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
              <form
                onSubmit={handleEmailChange}
                style={{ display: "grid", gap: 12 }}
              >
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>New Email</span>
                  <input
                    style={inputStyle}
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="new@example.com"
                    required
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>Current Password</span>
                  <input
                    style={inputStyle}
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="your current password"
                    required
                  />
                </label>
                <div>
                  <button
                    type="submit"
                    disabled={emailLoading}
                    style={
                      emailLoading
                        ? {
                            ...primaryButtonStyle,
                            background: "#94a3b8",
                            borderColor: "#94a3b8",
                            cursor: "not-allowed",
                          }
                        : primaryButtonStyle
                    }
                  >
                    {emailLoading ? "Sending…" : "Request Email Change"}
                  </button>
                </div>
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
          </section>
        </>
      }
      onBack={handleLogout}
      hideRightSection
    />
  );
}
