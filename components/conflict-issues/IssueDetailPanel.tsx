"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  type ClientAuthSession,
  getPostLogoutLoginPath,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";

type Role = ClientAuthSession["user"]["role"];

function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProposalKind = "REDUCE_QUANTITY" | "DELAY_DUE_DATE" | "CANCEL";
type ProposalStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "STALE";

type CommentProposal = {
  proposal: {
    kind: ProposalKind;
    newQuantity?: number;
    newDueDate?: string;
  };
  expectedOrderUpdatedAt: string;
  status: ProposalStatus;
};

type TimelineComment = {
  kind: "comment";
  id: string;
  issueId: string;
  authorId: string;
  authorUsername: string | null;
  authorEmail: string;
  authorRole: string;
  body: string;
  proposal: CommentProposal | null;
  editedAt: string | null;
  createdAt: string;
};

type TimelineEvent = {
  kind: "event";
  id: string;
  issueId: string;
  actorId: string;
  actorUsername: string | null;
  type: string;
  payload: unknown;
  createdAt: string;
};

type TimelineItem = TimelineComment | TimelineEvent;

type IssueDetail = {
  id: string;
  number: number;
  orderId: string;
  orderName: string;
  orderType: string;
  title: string;
  status: string;
  resolution: string | null;
  createdById: string;
  createdByUsername: string | null;
  assigneeId: string;
  assigneeUsername: string | null;
  assigneeEmail: string;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contextSnapshot: {
    previewRunAt?: string;
    reschedulePolicy?: string;
    windowStart?: string;
    windowEnd?: string;
    requiredQuantity?: number;
    totalAvailableInWindow?: number;
    deficit?: number;
    factoriesConsidered?: Array<{
      id: string;
      productionType: string;
      maxCapacity: number;
    }>;
    orderSnapshot?: {
      quantity: number;
      dueDate: string;
      status: string;
      updatedAt: string;
    };
  };
  commentCount: number;
  orderDueDate: string;
  orderQuantity: number;
  orderStatus: string;
  orderUpdatedAt: string;
  timeline: TimelineItem[];
};

type SuggestionResult = {
  computedAt: string;
  scenarios: {
    maxFitInOriginalWindow: { quantity: number; originalDueDate: string };
    earliestFitForOriginalQty: {
      dueDate: string | null;
      daysDelayed: number;
      searchHorizonDays: number;
    } | null;
  };
  caveat: string;
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  OPEN: { bg: "#dcfce7", color: "#166534" },
  IN_DISCUSSION: { bg: "#dbeafe", color: "#1e40af" },
  RESOLVED: { bg: "#f3f4f6", color: "#374151" },
  CLOSED: { bg: "#fee2e2", color: "#991b1b" },
};

const PROPOSAL_STATUS_COLOR: Record<
  ProposalStatus,
  { bg: string; color: string }
> = {
  PENDING: { bg: "#fef9c3", color: "#854d0e" },
  ACCEPTED: { bg: "#dcfce7", color: "#166534" },
  REJECTED: { bg: "#fee2e2", color: "#991b1b" },
  STALE: { bg: "#f1f5f9", color: "#64748b" },
};

const ROLE_COLOR: Record<string, { bg: string; color: string }> = {
  ADMIN: { bg: "#dbeafe", color: "#1e40af" },
  SUPERADMIN: { bg: "#f3e8ff", color: "#6b21a8" },
  SALES: { bg: "#dcfce7", color: "#166534" },
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-CA");
}

function toDateOnlyUtc(dateStr: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return new Date(dateStr).toISOString().slice(0, 10);
}

function addDaysToDateOnly(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Earliest selectable date for sales delay proposals (strictly after current due date). */
function minSalesDelayDueDate(orderDueDate: string, today?: string): string {
  const dayAfterDue = addDaysToDateOnly(toDateOnlyUtc(orderDueDate), 1);
  if (!today) return dayAfterDue;
  return dayAfterDue > today ? dayAfterDue : today;
}

function isValidSalesDelayDueDate(
  orderDueDate: string,
  newDueDate: string,
  today?: string,
): boolean {
  if (newDueDate <= toDateOnlyUtc(orderDueDate)) return false;
  if (today && newDueDate < today) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const sc = STATUS_COLOR[status] ?? { bg: "#f3f4f6", color: "#374151" };
  return (
    <span
      style={{
        background: sc.bg,
        color: sc.color,
        padding: "3px 10px",
        borderRadius: 99,
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "0.02em",
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const rc = ROLE_COLOR[role] ?? { bg: "#f3f4f6", color: "#374151" };
  return (
    <span
      style={{
        background: rc.bg,
        color: rc.color,
        padding: "1px 6px",
        borderRadius: 4,
        fontWeight: 600,
        fontSize: 11,
      }}
    >
      {role}
    </span>
  );
}

function ProposalCard({
  proposal,
  commentId,
  issueNumber,
  currentUserId,
  commentAuthorId,
  currentUserRole,
  issueStatus,
  onAction,
}: {
  proposal: CommentProposal;
  commentId: string;
  issueNumber: number;
  currentUserId: string;
  commentAuthorId: string;
  currentUserRole: Role;
  issueStatus: string;
  onAction: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const psc = PROPOSAL_STATUS_COLOR[proposal.status];

  // Can accept/reject only if:
  // - It's not your own proposal
  // - Proposal is PENDING
  // - Issue is not resolved/closed
  const canInteract =
    commentAuthorId !== currentUserId &&
    proposal.status === "PENDING" &&
    issueStatus !== "RESOLVED" &&
    issueStatus !== "CLOSED";

  const doAction = async (action: "accept" | "reject") => {
    setActing(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/conflict-issues/${issueNumber}/comments/${commentId}/${action}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? `Failed to ${action} proposal.`);
      } else {
        onAction();
      }
    } catch {
      setError("Network error.");
    } finally {
      setActing(false);
    }
  };

  const describeProposal = () => {
    const p = proposal.proposal;
    if (p.kind === "REDUCE_QUANTITY") {
      return `Reduce quantity → ${p.newQuantity?.toLocaleString()}`;
    }
    if (p.kind === "DELAY_DUE_DATE") {
      return `Delay due date → ${p.newDueDate}`;
    }
    if (p.kind === "CANCEL") {
      return "Cancel order";
    }
    return "Unknown proposal";
  };

  void currentUserRole; // used for display checks in parent

  return (
    <div
      style={{
        margin: "10px 0",
        border: "2px solid #e2e8f0",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          fontSize: 12,
          fontWeight: 700,
          color: "#475569",
          letterSpacing: "0.05em",
        }}
      >
        PROPOSAL
      </div>
      <div style={{ padding: "10px 12px" }}>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 14,
            fontWeight: 600,
            color: "#0f172a",
          }}
        >
          {describeProposal()}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              background: psc.bg,
              color: psc.color,
              padding: "2px 8px",
              borderRadius: 99,
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            {proposal.status}
          </span>

          {canInteract && (
            <>
              <button
                type="button"
                disabled={acting}
                onClick={() => doAction("accept")}
                style={{
                  padding: "4px 12px",
                  background: "#16a34a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: acting ? 0.6 : 1,
                }}
              >
                ✓ Accept
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => doAction("reject")}
                style={{
                  padding: "4px 12px",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: acting ? 0.6 : 1,
                }}
              >
                ✗ Reject
              </button>
            </>
          )}

          {error && (
            <span style={{ color: "#dc2626", fontSize: 12 }}>{error}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: TimelineEvent }) {
  const label: Record<string, string> = {
    OPENED: "opened this issue",
    REASSIGNED: "reassigned this issue",
    PROPOSAL_ACCEPTED: "accepted a proposal",
    PROPOSAL_REJECTED: "rejected a proposal",
    ORDER_UPDATED: "applied order changes",
    REPREVIEW_RAN: "ran a re-preview",
    RESOLVED: "marked this issue as resolved",
    REOPENED: "reopened this issue",
    CLOSED: "closed this issue",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        color: "#64748b",
        fontSize: 12,
      }}
    >
      <span style={{ fontSize: 14 }}>⚙</span>
      <span>
        <strong style={{ color: "#334155" }}>
          @{event.actorUsername ?? event.actorId.slice(0, 8)}
        </strong>{" "}
        {label[event.type] ?? event.type}{" "}
        <span style={{ color: "#94a3b8" }}>{timeAgo(event.createdAt)}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reply box
// ---------------------------------------------------------------------------

function ReplyBox({
  issueNumber,
  issueId,
  orderUpdatedAt,
  orderDueDate,
  currentUserRole,
  issueStatus,
  onSubmit,
}: {
  issueNumber: number;
  issueId: string;
  orderUpdatedAt: string;
  orderDueDate: string;
  currentUserRole: Role;
  issueStatus: string;
  onSubmit: () => void;
}) {
  const [body, setBody] = useState("");
  const [showProposal, setShowProposal] = useState(false);
  const [proposalKind, setProposalKind] =
    useState<ProposalKind>("REDUCE_QUANTITY");
  const [newQuantity, setNewQuantity] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClosed = issueStatus === "RESOLVED" || issueStatus === "CLOSED";
  const isSales = currentUserRole === "SALES";
  const salesDelayMinDate = isSales
    ? minSalesDelayDueDate(orderDueDate, new Date().toISOString().slice(0, 10))
    : undefined;
  const currentDueDateOnly = toDateOnlyUtc(orderDueDate);

  void issueId;

  const handleSubmit = async () => {
    if (!body.trim()) {
      setError("Comment body is required.");
      return;
    }
    setSubmitting(true);
    setError(null);

    let proposal: Record<string, unknown> | undefined;
    if (showProposal) {
      if (proposalKind === "REDUCE_QUANTITY") {
        const qty = parseInt(newQuantity, 10);
        if (!qty || qty <= 0) {
          setError("Please enter a valid quantity.");
          setSubmitting(false);
          return;
        }
        proposal = { kind: "REDUCE_QUANTITY", newQuantity: qty };
      } else if (proposalKind === "DELAY_DUE_DATE") {
        if (!newDueDate) {
          setError("Please select a new due date.");
          setSubmitting(false);
          return;
        }
        if (
          isSales &&
          !isValidSalesDelayDueDate(
            orderDueDate,
            newDueDate,
            new Date().toISOString().slice(0, 10),
          )
        ) {
          setError(
            `New due date must be after ${currentDueDateOnly} and cannot be in the past.`,
          );
          setSubmitting(false);
          return;
        }
        proposal = { kind: "DELAY_DUE_DATE", newDueDate };
      } else {
        proposal = { kind: "CANCEL" };
      }
    }

    try {
      const payload: Record<string, unknown> = { body };
      if (proposal) {
        payload.proposal = proposal;
        payload.expectedOrderUpdatedAt = orderUpdatedAt;
      }

      const res = await apiFetch(
        `/api/conflict-issues/${issueNumber}/comments`,
        { method: "POST", body: JSON.stringify(payload) },
      );

      if (!res.ok) {
        const data = (await res.json()) as {
          error?: string;
          details?: unknown;
        };
        setError(data.error ?? "Failed to post comment.");
      } else {
        setBody("");
        setShowProposal(false);
        setNewQuantity("");
        setNewDueDate("");
        onSubmit();
      }
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isClosed) {
    return (
      <div
        style={{
          padding: 16,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          color: "#64748b",
          fontSize: 13,
          textAlign: "center",
        }}
      >
        This issue is {issueStatus.toLowerCase()}. Reopen it to add comments.
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid #dbe3ef",
        borderRadius: 8,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #f1f5f9",
          background: "#f8fafc",
          fontSize: 12,
          fontWeight: 600,
          color: "#475569",
        }}
      >
        Add a comment
      </div>
      <div style={{ padding: 12 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Leave a comment…"
          rows={3}
          style={{
            width: "100%",
            padding: "8px 10px",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            fontSize: 13,
            color: "#0f172a",
            background: "#fff",
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />

        {/* Structured proposal toggle */}
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowProposal(!showProposal)}
            style={{
              background: "none",
              border: "none",
              color: "#1d4ed8",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
            }}
          >
            {showProposal ? "▾" : "▸"} Add structured proposal
          </button>
        </div>

        {showProposal && (
          <div
            style={{
              marginTop: 8,
              padding: 12,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(
                [
                  ["REDUCE_QUANTITY", "Reduce quantity"],
                  ["DELAY_DUE_DATE", "Delay due date"],
                  ["CANCEL", "Cancel order"],
                ] as [ProposalKind, string][]
              ).map(([kind, label]) => (
                <label
                  key={kind}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="proposalKind"
                    checked={proposalKind === kind}
                    onChange={() => setProposalKind(kind)}
                  />
                  {label}
                </label>
              ))}
            </div>

            {proposalKind === "REDUCE_QUANTITY" && (
              <input
                type="number"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                placeholder="New quantity"
                min={1}
                style={{
                  marginTop: 8,
                  padding: "4px 8px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  fontSize: 13,
                  width: 160,
                }}
              />
            )}

            {proposalKind === "DELAY_DUE_DATE" && (
              <div style={{ marginTop: 8 }}>
                <input
                  type="date"
                  value={newDueDate}
                  min={salesDelayMinDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                />
                {isSales && (
                  <p
                    style={{
                      margin: "6px 0 0",
                      fontSize: 12,
                      color: "#64748b",
                    }}
                  >
                    Must be after current due date ({currentDueDateOnly}).
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            style={{
              padding: "6px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 700,
              opacity: submitting ? 0.6 : 1,
            }}
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({
  issue,
  currentUserRole,
  onAction,
}: {
  issue: IssueDetail;
  currentUserRole: Role;
  onAction: () => void;
}) {
  const [suggestions, setSuggestions] = useState<SuggestionResult | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [adminAction, setAdminAction] = useState<"CLOSE" | "REOPEN" | null>(
    null,
  );
  const [actioning, setActioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reassignId, setReassignId] = useState("");

  const fetchSuggestions = useCallback(async () => {
    setLoadingSuggestions(true);
    setSuggestionsError(null);
    try {
      const res = await apiFetch(
        `/api/conflict-issues/${issue.number}/suggestions`,
      );
      if (res.ok) {
        setSuggestions((await res.json()) as SuggestionResult);
      } else {
        setSuggestionsError("Failed to load suggestions.");
      }
    } catch {
      setSuggestionsError("Network error.");
    } finally {
      setLoadingSuggestions(false);
    }
  }, [issue.number]);

  useEffect(() => {
    apiFetch(`/api/conflict-issues/${issue.number}/suggestions`)
      .then(async (res) => {
        if (res.ok) setSuggestions((await res.json()) as SuggestionResult);
        else setSuggestionsError("Failed to load suggestions.");
      })
      .catch(() => setSuggestionsError("Network error."))
      .finally(() => setLoadingSuggestions(false));
  }, [issue.number]);

  const doAdminAction = async () => {
    if (!adminAction) return;
    setActioning(true);
    setActionError(null);
    try {
      const payload: Record<string, unknown> = { action: adminAction };
      if (adminAction === "REOPEN") {
        // Actually "REOPEN" action
      }
      const res = await apiFetch(`/api/conflict-issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setActionError(data.error ?? "Action failed.");
      } else {
        setAdminAction(null);
        onAction();
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setActioning(false);
    }
  };

  const doCancelOrder = async () => {
    setActioning(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/conflict-issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "CANCEL_ORDER" }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setActionError(data.error ?? "Cancel failed.");
      } else {
        onAction();
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setActioning(false);
    }
  };

  const doReassign = async () => {
    if (!reassignId.trim()) return;
    setActioning(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/conflict-issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "REASSIGN",
          assigneeId: reassignId.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setActionError(data.error ?? "Reassign failed.");
      } else {
        setReassignId("");
        onAction();
      }
    } catch {
      setActionError("Network error.");
    } finally {
      setActioning(false);
    }
  };

  const isAdmin =
    currentUserRole === "ADMIN" || currentUserRole === "SUPERADMIN";
  const snap = issue.contextSnapshot;

  const sidebarCard = (title: string, children: React.ReactNode) => (
    <div
      style={{
        border: "1px solid #dbe3ef",
        borderRadius: 8,
        marginBottom: 12,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          background: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          fontSize: 12,
          fontWeight: 700,
          color: "#475569",
          letterSpacing: "0.04em",
        }}
      >
        {title}
      </div>
      <div style={{ padding: "10px 12px" }}>{children}</div>
    </div>
  );

  const metaRow = (label: string, value: React.ReactNode) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 4,
        fontSize: 12,
      }}
    >
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "#0f172a" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ width: "100%", minWidth: 0, maxWidth: 400 }}>
      {/* Order info */}
      {sidebarCard(
        "ORDER",
        <>
          {metaRow("Name", issue.orderName)}
          {metaRow("ID", issue.orderId)}
          {metaRow("Type", issue.orderType)}
          {metaRow("Quantity", issue.orderQuantity.toLocaleString())}
          {metaRow("Due Date", formatDate(issue.orderDueDate))}
          {metaRow("Status", issue.orderStatus)}
        </>,
      )}

      {/* Conflict context */}
      {sidebarCard(
        "CONFLICT CONTEXT",
        <>
          {snap.reschedulePolicy && metaRow("Policy", snap.reschedulePolicy)}
          {snap.windowStart &&
            snap.windowEnd &&
            metaRow("Window", `${snap.windowStart} → ${snap.windowEnd}`)}
          {snap.requiredQuantity !== undefined &&
            metaRow("Required", snap.requiredQuantity.toLocaleString())}
          {snap.totalAvailableInWindow !== undefined &&
            metaRow("Available", snap.totalAvailableInWindow.toLocaleString())}
          {snap.deficit !== undefined && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 4,
                fontSize: 12,
              }}
            >
              <span style={{ color: "#64748b" }}>Deficit</span>
              <span style={{ fontWeight: 700, color: "#dc2626" }}>
                {snap.deficit.toLocaleString()}
              </span>
            </div>
          )}
          {snap.factoriesConsidered && snap.factoriesConsidered.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
              Factories:{" "}
              {snap.factoriesConsidered.map((f) => f.productionType).join(", ")}
            </div>
          )}
        </>,
      )}

      {/* Suggestions */}
      {sidebarCard(
        "📊 SUGGESTIONS",
        <>
          {loadingSuggestions && (
            <p style={{ fontSize: 12, color: "#64748b" }}>Computing…</p>
          )}
          {suggestionsError && (
            <p style={{ fontSize: 12, color: "#dc2626" }}>{suggestionsError}</p>
          )}
          {suggestions && (
            <>
              <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 8px" }}>
                as of {timeAgo(suggestions.computedAt)}
                <button
                  type="button"
                  onClick={() => void fetchSuggestions()}
                  style={{
                    marginLeft: 6,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#1d4ed8",
                    fontSize: 11,
                  }}
                >
                  ↻
                </button>
              </p>

              {/* Max fit */}
              <div
                style={{
                  marginBottom: 10,
                  padding: 8,
                  background: "#f8fafc",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div
                  style={{ fontWeight: 600, marginBottom: 2, color: "#0f172a" }}
                >
                  Keep original due{" "}
                  {suggestions.scenarios.maxFitInOriginalWindow.originalDueDate}
                </div>
                <div style={{ color: "#475569" }}>
                  Max schedulable:{" "}
                  <strong>
                    {suggestions.scenarios.maxFitInOriginalWindow.quantity.toLocaleString()}
                  </strong>
                </div>
              </div>

              {/* Earliest fit */}
              {suggestions.scenarios.earliestFitForOriginalQty && (
                <div
                  style={{
                    marginBottom: 8,
                    padding: 8,
                    background: "#f8fafc",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 2,
                      color: "#0f172a",
                    }}
                  >
                    Keep original quantity
                  </div>
                  {suggestions.scenarios.earliestFitForOriginalQty.dueDate ? (
                    <div style={{ color: "#475569" }}>
                      Earliest date:{" "}
                      <strong>
                        {
                          suggestions.scenarios.earliestFitForOriginalQty
                            .dueDate
                        }
                      </strong>{" "}
                      (+
                      {
                        suggestions.scenarios.earliestFitForOriginalQty
                          .daysDelayed
                      }{" "}
                      days)
                    </div>
                  ) : (
                    <div style={{ color: "#dc2626" }}>
                      Not schedulable within{" "}
                      {
                        suggestions.scenarios.earliestFitForOriginalQty
                          .searchHorizonDays
                      }{" "}
                      days
                    </div>
                  )}
                </div>
              )}

              <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>
                ⚠ {suggestions.caveat}
              </p>
            </>
          )}
        </>,
      )}

      {/* Participants */}
      {sidebarCard(
        "PARTICIPANTS",
        <>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
            <span style={{ color: "#64748b" }}>Created by: </span>@
            {issue.createdByUsername ?? issue.createdById.slice(0, 8)}
          </div>
          <div style={{ fontSize: 12, color: "#334155" }}>
            <span style={{ color: "#64748b" }}>Assignee: </span>@
            {issue.assigneeUsername ?? issue.assigneeEmail}
          </div>
        </>,
      )}

      {/* Admin actions */}
      {isAdmin &&
        sidebarCard(
          "ACTIONS",
          <>
            {issue.status !== "RESOLVED" && issue.status !== "CLOSED" && (
              <>
                <button
                  type="button"
                  disabled={actioning}
                  onClick={() => void doCancelOrder()}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "6px 12px",
                    marginBottom: 6,
                    background: "#fef2f2",
                    color: "#991b1b",
                    border: "1px solid #fecaca",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "left",
                    opacity: actioning ? 0.6 : 1,
                  }}
                >
                  Cancel order
                </button>
                <button
                  type="button"
                  disabled={actioning}
                  onClick={() => {
                    setAdminAction("CLOSE");
                    void setTimeout(doAdminAction, 0);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "6px 12px",
                    marginBottom: 6,
                    background: "#f1f5f9",
                    color: "#374151",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    textAlign: "left",
                    opacity: actioning ? 0.6 : 1,
                  }}
                >
                  Close as won&apos;t fix
                </button>
              </>
            )}

            {(issue.status === "CLOSED" || issue.status === "RESOLVED") && (
              <button
                type="button"
                disabled={actioning}
                onClick={() => {
                  setAdminAction("REOPEN");
                  void setTimeout(doAdminAction, 0);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "6px 12px",
                  marginBottom: 6,
                  background: "#f1f5f9",
                  color: "#374151",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "left",
                  opacity: actioning ? 0.6 : 1,
                }}
              >
                Reopen issue
              </button>
            )}

            {/* Reassign */}
            <div style={{ marginTop: 6 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, color: "#64748b" }}>
                Reassign to (user ID):
              </p>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={reassignId}
                  onChange={(e) => setReassignId(e.target.value)}
                  placeholder="SALES user ID"
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    fontSize: 12,
                    minWidth: 0,
                  }}
                />
                <button
                  type="button"
                  disabled={actioning || !reassignId.trim()}
                  onClick={doReassign}
                  style={{
                    padding: "4px 8px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    opacity: actioning || !reassignId.trim() ? 0.5 : 1,
                  }}
                >
                  OK
                </button>
              </div>
            </div>

            {actionError && (
              <p style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>
                {actionError}
              </p>
            )}
          </>,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue detail (embedded in Order Issues split view or standalone via redirect)
// ---------------------------------------------------------------------------

const panelFont: React.CSSProperties = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: "#0f172a",
};

export function IssueDetailPanel({
  issueNumber,
}: {
  issueNumber: number;
  /** Reserved for list/detail UX (e.g. clear selection); not shown in header. */
  onClear?: () => void;
}) {
  const router = useRouter();
  const session = useClientAuthSession();
  const role: Role = session?.user.role ?? "SALES";

  useEffect(() => {
    if (session === null) router.replace(getPostLogoutLoginPath());
  }, [router, session]);

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIssue = useCallback(async () => {
    if (Number.isNaN(issueNumber) || issueNumber <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/conflict-issues/${issueNumber}`);
      if (res.ok) {
        setIssue((await res.json()) as IssueDetail);
      } else if (res.status === 404) {
        setIssue(null);
        setError("Issue not found.");
      } else {
        setIssue(null);
        setError("Failed to load issue.");
      }
    } catch {
      setIssue(null);
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [issueNumber]);

  useEffect(() => {
    if (session === undefined || session === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchIssue sets loading/error state before the async fetch; this is intentional
    void fetchIssue();
  }, [session, issueNumber, fetchIssue]);

  if (session === undefined) {
    return (
      <div
        style={{ ...panelFont, padding: 24, color: "#64748b", fontSize: 13 }}
      >
        Loading…
      </div>
    );
  }
  if (session === null) {
    return (
      <div
        style={{ ...panelFont, padding: 24, color: "#64748b", fontSize: 13 }}
      >
        Redirecting…
      </div>
    );
  }

  return (
    <div
      style={{
        ...panelFont,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      {/* Title + meta: above scroll area, stays fixed while body scrolls */}
      {issue && (
        <div
          style={{
            flexShrink: 0,
            paddingBottom: 12,
            marginBottom: 0,
            borderBottom: "1px solid #e2e8f0",
            background: "#fff",
            zIndex: 2,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                color: "#0f172a",
                flex: 1,
                minWidth: 0,
              }}
            >
              <span style={{ color: "#64748b", fontWeight: 500 }}>
                #{issue.number}
              </span>{" "}
              {issue.title}
            </h2>
            <StatusBadge status={issue.status} />
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>
            Opened by{" "}
            <strong>
              @{issue.createdByUsername ?? issue.createdById.slice(0, 8)}
            </strong>
            {" · "}
            assigned to{" "}
            <strong>@{issue.assigneeUsername ?? issue.assigneeEmail}</strong>
            {" · "}
            {timeAgo(issue.createdAt)}
            {" · "}
            {issue.commentCount} comment{issue.commentCount !== 1 ? "s" : ""}
          </p>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {issue ? (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "row",
              gap: 20,
              overflow: "hidden",
              paddingTop: 16,
            }}
          >
            {/* Column 1: comment history + add comment — own scroll */}
            <div
              style={{
                flex: "2 1 0",
                minWidth: 0,
                minHeight: 0,
                overflow: "auto",
                paddingRight: 8,
              }}
            >
              {issue.timeline.length === 0 && (
                <p
                  style={{
                    color: "#64748b",
                    fontSize: 13,
                    fontStyle: "italic",
                  }}
                >
                  No comments yet.
                </p>
              )}

              {issue.timeline.map((item) => {
                if (item.kind === "event") {
                  return <EventRow key={item.id} event={item} />;
                }

                const comment = item as TimelineComment;
                const rc = ROLE_COLOR[comment.authorRole] ?? {
                  bg: "#f3f4f6",
                  color: "#374151",
                };
                void rc;
                const isOwn = comment.authorId === session.user.id;

                return (
                  <div
                    key={comment.id}
                    style={{
                      border: "1px solid #dbe3ef",
                      borderRadius: 8,
                      marginBottom: 12,
                      background: isOwn ? "#f8fafc" : "#fff",
                      overflow: "hidden",
                    }}
                  >
                    {/* Comment header */}
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "#f8fafc",
                        borderBottom: "1px solid #e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ fontSize: 13, color: "#0f172a" }}>
                        @{comment.authorUsername ?? comment.authorEmail}
                      </strong>
                      <RoleBadge role={comment.authorRole} />
                      {isOwn && (
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          You
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 12,
                          color: "#94a3b8",
                          marginLeft: "auto",
                        }}
                      >
                        {timeAgo(comment.createdAt)}
                        {comment.editedAt && " (edited)"}
                      </span>
                    </div>

                    {/* Comment body */}
                    <div style={{ padding: "10px 12px" }}>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          color: "#1e293b",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {comment.body}
                      </p>

                      {comment.proposal && (
                        <ProposalCard
                          proposal={comment.proposal}
                          commentId={comment.id}
                          issueNumber={issue.number}
                          currentUserId={session.user.id}
                          commentAuthorId={comment.authorId}
                          currentUserRole={role}
                          issueStatus={issue.status}
                          onAction={() => void fetchIssue()}
                        />
                      )}
                    </div>
                  </div>
                );
              })}

              <div style={{ marginTop: 20 }}>
                <ReplyBox
                  issueNumber={issue.number}
                  issueId={issue.id}
                  orderUpdatedAt={issue.orderUpdatedAt}
                  orderDueDate={issue.orderDueDate}
                  currentUserRole={role}
                  issueStatus={issue.status}
                  onSubmit={() => void fetchIssue()}
                />
              </div>
            </div>

            {/* Column 2: ORDER, CONFLICT CONTEXT, etc. — own scroll */}
            <div
              style={{
                flex: "1 1 0",
                minWidth: 0,
                minHeight: 0,
                overflow: "auto",
              }}
            >
              <Sidebar
                issue={issue}
                currentUserRole={role}
                onAction={() => void fetchIssue()}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              paddingRight: 4,
              paddingTop: 8,
            }}
          >
            {loading && (
              <p style={{ color: "#64748b", fontSize: 13 }}>Loading…</p>
            )}
            {error && <p style={{ color: "#dc2626", fontSize: 13 }}>{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
