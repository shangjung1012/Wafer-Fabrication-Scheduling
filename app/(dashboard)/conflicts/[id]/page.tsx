"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import {
  logoutClientAuthSession,
  type ClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type Role = ClientAuthSession["user"]["role"];

type CommentType = "COMMENT" | "PROPOSAL" | "RESOLUTION" | "REQUEUE";

type ConflictComment = {
  id: string;
  orderId: string;
  authorId: string;
  authorUsername: string | null;
  authorRole: string;
  content: string;
  type: CommentType;
  proposalData: {
    newDueDate?: string;
    newQuantity?: number;
    targetFactoryNote?: string;
  } | null;
  createdAt: string;
};

type ConflictDetail = {
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
  comments: ConflictComment[];
};

function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const pageShell: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  maxWidth: 960,
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

const COMMENT_STYLE: Record<
  CommentType,
  {
    bg: string;
    border: string;
    label: string;
    labelBg: string;
    labelColor: string;
  }
> = {
  COMMENT: {
    bg: "#fff",
    border: "#dbe3ef",
    label: "Comment",
    labelBg: "#f1f5f9",
    labelColor: "#475569",
  },
  PROPOSAL: {
    bg: "#f0fdf4",
    border: "#86efac",
    label: "Proposal",
    labelBg: "#dcfce7",
    labelColor: "#166534",
  },
  RESOLUTION: {
    bg: "#eff6ff",
    border: "#93c5fd",
    label: "Resolved",
    labelBg: "#dbeafe",
    labelColor: "#1e40af",
  },
  REQUEUE: {
    bg: "#fefce8",
    border: "#fde047",
    label: "Requeued",
    labelBg: "#fef9c3",
    labelColor: "#854d0e",
  },
};

const ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  SALES: { bg: "#dcfce7", color: "#166534" },
  ADMIN: { bg: "#dbeafe", color: "#1e40af" },
  SUPERADMIN: { bg: "#f3e8ff", color: "#6b21a8" },
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ConflictDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const session = useClientAuthSession();

  const role: Role | undefined = session?.user.role;
  const isSales = role === "SALES";
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";

  const [detail, setDetail] = useState<ConflictDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Comment form
  const [commentText, setCommentText] = useState("");
  const [showProposal, setShowProposal] = useState(false);
  const [propDueDate, setPropDueDate] = useState("");
  const [propQuantity, setPropQuantity] = useState("");
  const [propFactoryNote, setPropFactoryNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  // Admin resolve modal state
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveDueDate, setResolveDueDate] = useState("");
  const [resolveQuantity, setResolveQuantity] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Requeue state
  const [requeueNote, setRequeueNote] = useState("");
  const [requeuing, setRequeuing] = useState(false);

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [router, session]);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/conflicts/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `Error ${res.status}`);
        return;
      }
      setDetail(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (session) fetchDetail();
  }, [session, fetchDetail]);

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace("/login");
  }, [router]);

  // Submit comment / proposal
  const submitComment = useCallback(async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    setCommentError(null);

    const proposalData =
      showProposal && (propDueDate || propQuantity || propFactoryNote)
        ? {
            ...(propDueDate ? { newDueDate: propDueDate } : {}),
            ...(propQuantity
              ? { newQuantity: parseInt(propQuantity, 10) }
              : {}),
            ...(propFactoryNote ? { targetFactoryNote: propFactoryNote } : {}),
          }
        : undefined;

    try {
      const res = await apiFetch(`/api/conflicts/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: commentText.trim(), proposalData }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCommentError(body.message ?? `Error ${res.status}`);
        return;
      }
      setCommentText("");
      setPropDueDate("");
      setPropQuantity("");
      setPropFactoryNote("");
      setShowProposal(false);
      await fetchDetail();
    } catch {
      setCommentError("Network error");
    } finally {
      setSubmitting(false);
    }
  }, [
    id,
    commentText,
    showProposal,
    propDueDate,
    propQuantity,
    propFactoryNote,
    fetchDetail,
  ]);

  // Admin resolve with optional proposal applied
  const submitResolve = useCallback(async () => {
    setResolving(true);
    setResolveError(null);
    const applyProposal =
      resolveDueDate || resolveQuantity
        ? {
            ...(resolveDueDate ? { newDueDate: resolveDueDate } : {}),
            ...(resolveQuantity
              ? { newQuantity: parseInt(resolveQuantity, 10) }
              : {}),
          }
        : undefined;

    try {
      const res = await apiFetch(`/api/conflicts/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ applyProposal, note: resolveNote || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setResolveError(body.message ?? `Error ${res.status}`);
        return;
      }
      setShowResolveModal(false);
      router.push("/conflicts");
    } catch {
      setResolveError("Network error");
    } finally {
      setResolving(false);
    }
  }, [id, resolveDueDate, resolveQuantity, resolveNote, router]);

  // Admin requeue (no changes)
  const submitRequeue = useCallback(async () => {
    setRequeuing(true);
    try {
      const res = await apiFetch(`/api/conflicts/${id}/requeue`, {
        method: "POST",
        body: JSON.stringify({ note: requeueNote || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.message ?? `Error ${res.status}`);
        return;
      }
      router.push("/conflicts");
    } catch {
      alert("Network error");
    } finally {
      setRequeuing(false);
    }
  }, [id, requeueNote, router]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
      {/* Nav */}
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        WOMS — Conflict Resolution
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
        <a href="/orders" style={navLink}>
          Orders
        </a>
        <a
          href="/conflicts"
          style={{
            ...navLink,
            background: "#ef4444",
            color: "#fff",
            border: "1px solid #ef4444",
          }}
        >
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

      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push("/conflicts")}
        style={{
          marginBottom: 16,
          fontSize: 13,
          color: "#334155",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: 0,
        }}
      >
        ← Back to Conflicts
      </button>

      {loading && !detail && (
        <div style={{ color: "#64748b", fontSize: 14 }}>Loading…</div>
      )}
      {error && (
        <div
          style={{
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {detail && (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* Main column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Issue header */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #dbe3ef",
                borderRadius: 10,
                padding: "16px 20px",
                marginBottom: 16,
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <span
                  style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}
                >
                  {detail.name}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 99,
                    background: "#fee2e2",
                    color: "#991b1b",
                    border: "1px solid #fca5a5",
                  }}
                >
                  CONFLICT
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  fontSize: 13,
                  color: "#475569",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Opened by{" "}
                  <strong>
                    {detail.applicantUsername ?? detail.applicantEmail}
                  </strong>
                </span>
                <span>·</span>
                <span>
                  Type <strong>{detail.type}</strong>
                </span>
                <span>·</span>
                <span>
                  {detail.commentCount} comment
                  {detail.commentCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>

            {/* Comment thread */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginBottom: 20,
              }}
            >
              {detail.comments.length === 0 ? (
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #dbe3ef",
                    borderRadius: 10,
                    padding: "20px",
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: 14,
                  }}
                >
                  No comments yet. Be the first to comment.
                </div>
              ) : (
                detail.comments.map((c) => (
                  <CommentBubble key={c.id} comment={c} />
                ))
              )}
            </div>

            {/* Reply box */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #dbe3ef",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 10,
                  marginTop: 0,
                }}
              >
                Leave a comment
              </h3>

              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment…"
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "8px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  resize: "vertical",
                  fontFamily: "inherit",
                  outline: "none",
                }}
              />

              {/* Proposal toggle (SALES only) */}
              {isSales && (
                <div style={{ marginTop: 10 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showProposal}
                      onChange={(e) => setShowProposal(e.target.checked)}
                    />
                    Add a resolution proposal (suggested changes)
                  </label>

                  {showProposal && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        background: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#166534",
                          marginBottom: 4,
                        }}
                      >
                        Proposal Details (leave blank if not applicable)
                      </div>
                      <label style={{ fontSize: 13 }}>
                        Suggested due date
                        <input
                          type="date"
                          value={propDueDate}
                          onChange={(e) => setPropDueDate(e.target.value)}
                          style={{
                            display: "block",
                            marginTop: 4,
                            padding: "5px 8px",
                            fontSize: 13,
                            borderRadius: 5,
                            border: "1px solid #cbd5e1",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        />
                      </label>
                      <label style={{ fontSize: 13 }}>
                        Suggested quantity
                        <input
                          type="number"
                          min={1}
                          value={propQuantity}
                          onChange={(e) => setPropQuantity(e.target.value)}
                          placeholder="e.g. 500"
                          style={{
                            display: "block",
                            marginTop: 4,
                            padding: "5px 8px",
                            fontSize: 13,
                            borderRadius: 5,
                            border: "1px solid #cbd5e1",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        />
                      </label>
                      <label style={{ fontSize: 13 }}>
                        Factory preference note
                        <input
                          type="text"
                          value={propFactoryNote}
                          onChange={(e) => setPropFactoryNote(e.target.value)}
                          placeholder="e.g. prefer factory A"
                          style={{
                            display: "block",
                            marginTop: 4,
                            padding: "5px 8px",
                            fontSize: 13,
                            borderRadius: 5,
                            border: "1px solid #cbd5e1",
                            width: "100%",
                            boxSizing: "border-box",
                          }}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {commentError && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "#991b1b",
                    background: "#fee2e2",
                    padding: "6px 10px",
                    borderRadius: 5,
                  }}
                >
                  {commentError}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 10,
                }}
              >
                <button
                  type="button"
                  onClick={submitComment}
                  disabled={submitting || !commentText.trim()}
                  style={{
                    padding: "7px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "none",
                    background:
                      submitting || !commentText.trim() ? "#cbd5e1" : "#0f172a",
                    color: "#fff",
                    cursor:
                      submitting || !commentText.trim() ? "default" : "pointer",
                  }}
                >
                  {submitting
                    ? "Posting…"
                    : showProposal && isSales
                      ? "Submit Proposal"
                      : "Comment"}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ width: 240, flexShrink: 0 }}>
            {/* Order details card */}
            <div
              style={{
                background: "#fff",
                border: "1px solid #dbe3ef",
                borderRadius: 10,
                padding: 16,
                marginBottom: 16,
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}
            >
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  margin: "0 0 12px",
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Order Details
              </h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <DetailRow
                  label="Qty"
                  value={detail.quantity.toLocaleString()}
                />
                <DetailRow
                  label="Due Date"
                  value={new Date(detail.dueDate).toLocaleDateString("en-CA")}
                />
                <DetailRow label="Type" value={detail.type} />
                <DetailRow
                  label="Applicant"
                  value={detail.applicantUsername ?? detail.applicantEmail}
                />
                <DetailRow
                  label="Created"
                  value={new Date(detail.createdAt).toLocaleDateString("en-CA")}
                />
                <DetailRow
                  label="Updated"
                  value={new Date(detail.updatedAt).toLocaleDateString("en-CA")}
                />
              </div>
            </div>

            {/* Admin actions card */}
            {isAdmin && (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #dbe3ef",
                  borderRadius: 10,
                  padding: 16,
                  boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                }}
              >
                <h3
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    margin: "0 0 12px",
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Admin Actions
                </h3>

                <button
                  type="button"
                  onClick={() => setShowResolveModal(true)}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "none",
                    background: "#1d4ed8",
                    color: "#fff",
                    cursor: "pointer",
                    marginBottom: 8,
                  }}
                >
                  Resolve & Requeue
                </button>

                <div
                  style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}
                >
                  Apply changes from a proposal, then return to pending.
                </div>

                <hr
                  style={{
                    border: "none",
                    borderTop: "1px solid #f1f5f9",
                    margin: "12px 0",
                  }}
                />

                <div style={{ marginBottom: 6 }}>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#64748b",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Requeue note (optional)
                  </label>
                  <input
                    type="text"
                    value={requeueNote}
                    onChange={(e) => setRequeueNote(e.target.value)}
                    placeholder="Reason for requeue…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "5px 8px",
                      fontSize: 12,
                      borderRadius: 5,
                      border: "1px solid #cbd5e1",
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={submitRequeue}
                  disabled={requeuing}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "1px solid #e2e8f0",
                    background: requeuing ? "#f1f5f9" : "#fff",
                    color: "#334155",
                    cursor: requeuing ? "default" : "pointer",
                  }}
                >
                  {requeuing ? "Requeuing…" : "Requeue (no changes)"}
                </button>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                  Return order to pending as-is.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {showResolveModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowResolveModal(false);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              width: 440,
              maxWidth: "90vw",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            }}
          >
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 4px" }}>
              Resolve & Requeue
            </h2>
            <p
              style={{
                fontSize: 13,
                color: "#64748b",
                marginTop: 0,
                marginBottom: 20,
              }}
            >
              Optionally apply changes from a sales proposal, then return the
              order to pending for the next scheduler run.
            </p>

            <label style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
              New due date (optional)
              <input
                type="date"
                value={resolveDueDate}
                onChange={(e) => setResolveDueDate(e.target.value)}
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: "6px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </label>

            <label style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
              New quantity (optional)
              <input
                type="number"
                min={1}
                value={resolveQuantity}
                onChange={(e) => setResolveQuantity(e.target.value)}
                placeholder="Leave blank to keep current"
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: "6px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </label>

            <label style={{ fontSize: 13, display: "block", marginBottom: 16 }}>
              Resolution note (optional)
              <input
                type="text"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="Reason or action taken…"
                style={{
                  display: "block",
                  marginTop: 4,
                  padding: "6px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              />
            </label>

            {resolveError && (
              <div
                style={{
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#991b1b",
                  background: "#fee2e2",
                  padding: "6px 10px",
                  borderRadius: 5,
                }}
              >
                {resolveError}
              </div>
            )}

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                onClick={() => setShowResolveModal(false)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#334155",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitResolve}
                disabled={resolving}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 6,
                  border: "none",
                  background: resolving ? "#93c5fd" : "#1d4ed8",
                  color: "#fff",
                  cursor: resolving ? "default" : "pointer",
                }}
              >
                {resolving ? "Resolving…" : "Confirm & Requeue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment bubble
// ---------------------------------------------------------------------------

function CommentBubble({ comment }: { comment: ConflictComment }) {
  const style = COMMENT_STYLE[comment.type];
  const roleBadge = ROLE_BADGE[comment.authorRole] ?? {
    bg: "#f1f5f9",
    color: "#475569",
  };
  const time = new Date(comment.createdAt).toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const isAction = comment.type === "RESOLUTION" || comment.type === "REQUEUE";

  if (isAction) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 0",
          color: "#64748b",
          fontSize: 13,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: style.labelBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {comment.type === "RESOLUTION" ? "✓" : "↺"}
        </div>
        <div style={{ flex: 1 }}>
          <strong>{comment.authorUsername ?? "Admin"}</strong>{" "}
          <span
            style={{
              display: "inline-block",
              padding: "1px 6px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 99,
              background: style.labelBg,
              color: style.labelColor,
            }}
          >
            {style.label}
          </span>{" "}
          <span>{comment.content}</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8" }}>
            {time}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          background: comment.type === "PROPOSAL" ? "#dcfce7" : "#f8fafc",
          borderBottom: `1px solid ${style.border}`,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: roleBadge.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            color: roleBadge.color,
            flexShrink: 0,
          }}
        >
          {(comment.authorUsername ?? "?")[0].toUpperCase()}
        </div>
        <strong style={{ fontSize: 13 }}>
          {comment.authorUsername ?? comment.authorId}
        </strong>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "1px 6px",
            borderRadius: 99,
            background: roleBadge.bg,
            color: roleBadge.color,
          }}
        >
          {comment.authorRole}
        </span>
        {comment.type === "PROPOSAL" && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 99,
              background: "#bbf7d0",
              color: "#14532d",
            }}
          >
            PROPOSAL
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
          {time}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "12px 14px" }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {comment.content}
        </p>

        {/* Proposal details */}
        {comment.proposalData &&
          Object.keys(comment.proposalData).length > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: 7,
                fontSize: 13,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: "#166534",
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                Proposed Changes
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {comment.proposalData.newDueDate && (
                  <div>
                    <span style={{ color: "#64748b" }}>New due date: </span>
                    <strong>{comment.proposalData.newDueDate}</strong>
                  </div>
                )}
                {comment.proposalData.newQuantity !== undefined && (
                  <div>
                    <span style={{ color: "#64748b" }}>New quantity: </span>
                    <strong>
                      {comment.proposalData.newQuantity.toLocaleString()}
                    </strong>
                  </div>
                )}
                {comment.proposalData.targetFactoryNote && (
                  <div>
                    <span style={{ color: "#64748b" }}>
                      Factory preference:{" "}
                    </span>
                    <strong>{comment.proposalData.targetFactoryNote}</strong>
                  </div>
                )}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar detail row
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <span style={{ color: "#64748b", flexShrink: 0 }}>{label}</span>
      <span
        style={{ fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}
      >
        {value}
      </span>
    </div>
  );
}
