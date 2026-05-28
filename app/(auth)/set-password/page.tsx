"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import {
  isValidUsername,
  normalizeUsername,
  usernameValidationMessage,
} from "@/modules/auth/username";

type InvitationPreview = {
  email: string;
  role: string;
  group: string | null;
  expiresAt: string;
};

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={<SetPasswordShell>Checking invitation...</SetPasswordShell>}
    >
      <SetPasswordContent />
    </Suspense>
  );
}

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<"verify" | "submit" | null>("verify");
  const [message, setMessage] = useState<string | null>(null);

  const passwordMismatch = useMemo(
    () =>
      password.length > 0 &&
      confirmPassword.length > 0 &&
      password !== confirmPassword,
    [password, confirmPassword],
  );
  const passwordTooShort = password.length > 0 && password.length < 8;
  const normalizedUsername = normalizeUsername(username);
  const usernameInvalid =
    username.trim().length > 0 && !isValidUsername(username);
  const canSubmit =
    loading === null &&
    !!preview &&
    isValidUsername(username) &&
    password.length >= 8 &&
    !passwordMismatch;

  useEffect(() => {
    let cancelled = false;

    async function verifyToken() {
      if (!token) {
        setLoading(null);
        setMessage("Invitation token is missing.");
        return;
      }

      setLoading("verify");
      setMessage(null);
      const response = await fetch(
        `/api/auth/invitations/verify?token=${encodeURIComponent(token)}`,
      );
      const body = await parseJson(response);
      if (cancelled) return;

      if (!response.ok) {
        setPreview(null);
        setMessage(
          (body as { message?: string } | null)?.message ??
            "Invitation is invalid or expired.",
        );
        setLoading(null);
        return;
      }

      const nextPreview = body as InvitationPreview;
      setPreview(nextPreview);
      setLoading(null);
    }

    verifyToken();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (password.length > 0 && password.length < 8) {
        setMessage("Password must be at least 8 characters.");
      }
      return;
    }

    setLoading("submit");
    setMessage(null);

    try {
      const response = await fetch("/api/auth/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username: normalizedUsername, password }),
      });
      const body = await parseJson(response);
      if (!response.ok) {
        setMessage(
          (body as { message?: string } | null)?.message ??
            "Failed to set password.",
        );
        return;
      }

      router.replace("/login");
    } finally {
      setLoading(null);
    }
  };

  return (
    <SetPasswordShell>
      <h1 style={{ margin: 0, fontSize: 24 }}>Set Password</h1>
      <p style={{ margin: "8px 0 20px", color: "#64748b", fontSize: 14 }}>
        Complete your invited Wafer Scheduling account.
      </p>

      {loading === "verify" && (
        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
          Checking invitation...
        </p>
      )}

      {preview && (
        <>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "96px minmax(0, 1fr)",
              gap: "8px 12px",
              margin: "0 0 18px",
              fontSize: 13,
            }}
          >
            <dt style={termStyle}>Email</dt>
            <dd style={descStyle}>{preview.email}</dd>
            <dt style={termStyle}>Role</dt>
            <dd style={descStyle}>{preview.role}</dd>
            <dt style={termStyle}>Group</dt>
            <dd style={descStyle}>{preview.group ?? "-"}</dd>
          </dl>

          <label style={labelStyle}>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="sales-1"
              style={inputStyle}
            />
          </label>
          <p
            style={{
              margin: "-4px 0 12px",
              color: usernameInvalid ? "#b91c1c" : "#64748b",
              fontSize: 13,
            }}
          >
            {usernameValidationMessage()}
          </p>

          <label style={labelStyle}>
            Password
            <span style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                style={{ ...inputStyle, marginTop: 0 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                style={iconButtonStyle}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>

          {passwordTooShort && (
            <p
              style={{ margin: "-4px 0 12px", color: "#b91c1c", fontSize: 13 }}
            >
              Password must be at least 8 characters.
            </p>
          )}

          <label style={labelStyle}>
            Confirm Password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>

          {passwordMismatch && (
            <p style={{ margin: "0 0 12px", color: "#b91c1c", fontSize: 13 }}>
              Passwords do not match.
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...primaryButtonStyle,
              ...(!canSubmit ? disabledButtonStyle : {}),
            }}
          >
            <KeyRound size={16} />
            {loading === "submit" ? "Saving" : "Set password"}
          </button>
        </>
      )}

      {message && (
        <p
          style={{
            margin: "18px 0 0",
            padding: "10px 12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          {message}
        </p>
      )}
    </SetPasswordShell>
  );
}

function SetPasswordShell({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        color: "#111827",
        padding: "32px 20px",
      }}
    >
      <section
        style={{
          maxWidth: 520,
          margin: "0 auto",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 24,
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
        }}
      >
        {children}
      </section>
    </main>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 12,
};

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 14,
};

const iconButtonStyle: CSSProperties = {
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
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  minHeight: 42,
  border: "1px solid #1d4ed8",
  borderRadius: 6,
  background: "#2563eb",
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

const disabledButtonStyle: CSSProperties = {
  borderColor: "#cbd5e1",
  background: "#94a3b8",
  color: "#f8fafc",
  cursor: "not-allowed",
  opacity: 0.8,
};

const termStyle: CSSProperties = {
  color: "#64748b",
  fontWeight: 600,
};

const descStyle: CSSProperties = {
  margin: 0,
  color: "#0f172a",
  minWidth: 0,
  overflowWrap: "anywhere",
};
