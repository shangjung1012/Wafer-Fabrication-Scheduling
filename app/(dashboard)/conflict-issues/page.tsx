"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getPostLogoutLoginPath,
  logoutClientAuthSession,
} from "@/modules/auth/client-session";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { IssueDetailPanel } from "@/components/conflict-issues/IssueDetailPanel";

function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssueRow = {
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
  commentCount: number;
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

const listPanelStyle: React.CSSProperties = {
  ...panelStyle,
  marginBottom: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  flex: 1,
  height: "100%",
};

const emptyRightStyle: React.CSSProperties = {
  border: "1px dashed #cbd5e1",
  borderRadius: 8,
  background: "#f8fafc",
  color: "#64748b",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 24,
  minHeight: 280,
  height: "100%",
  flex: 1,
};

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  OPEN: { bg: "#dcfce7", color: "#166534" },
  IN_DISCUSSION: { bg: "#dbeafe", color: "#1e40af" },
  RESOLVED: { bg: "#f3f4f6", color: "#374151" },
  CLOSED: { bg: "#fee2e2", color: "#991b1b" },
};

function StatusBadge({ status }: Readonly<{ status: string }>) {
  const sc = STATUS_COLOR[status] ?? { bg: "#f3f4f6", color: "#374151" };
  return (
    <span
      style={{
        background: sc.bg,
        color: sc.color,
        padding: "2px 8px",
        borderRadius: 99,
        fontWeight: 600,
        fontSize: 11,
        whiteSpace: "nowrap",
      }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function ConflictIssuesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useClientAuthSession();

  const issueParam = searchParams.get("issue");
  const selectedIssueNumber = issueParam ? parseInt(issueParam, 10) : NaN;
  const hasValidSelection =
    Number.isFinite(selectedIssueNumber) && selectedIssueNumber > 0;

  const openIssue = useCallback(
    (n: number) => {
      router.push(`/conflict-issues?issue=${n}`, { scroll: false });
    },
    [router],
  );

  const clearIssue = useCallback(() => {
    router.push("/conflict-issues", { scroll: false });
  }, [router]);

  useEffect(() => {
    if (session === null) router.replace(getPostLogoutLoginPath());
  }, [router, session]);

  const [activeTab, setActiveTab] = useState<"open" | "closed">("open");
  const [issues, setIssues] = useState<IssueRow[]>([]);
  /** Tab badges: both buckets, not derived from `issues` (which is only the active tab). */
  const [issueCounts, setIssueCounts] = useState({ open: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // Route only reads `statuses` (comma-separated); `status=` is ignored.
    Promise.all([
      apiFetch("/api/conflict-issues?statuses=OPEN,IN_DISCUSSION").then(
        async (res) => (res.ok ? ((await res.json()) as IssueRow[]) : []),
      ),
      apiFetch("/api/conflict-issues?statuses=RESOLVED,CLOSED").then(
        async (res) => (res.ok ? ((await res.json()) as IssueRow[]) : []),
      ),
    ])
      .then(([openLike, closedLike]) => {
        if (cancelled) return;
        setIssueCounts({
          open: openLike.length,
          closed: closedLike.length,
        });
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const url =
      activeTab === "open"
        ? "/api/conflict-issues?statuses=OPEN,IN_DISCUSSION"
        : "/api/conflict-issues?statuses=RESOLVED,CLOSED";
    apiFetch(url)
      .then(async (res) => {
        if (res.ok) {
          const rows = (await res.json()) as IssueRow[];
          setIssues(
            [...rows].sort(
              (x, y) =>
                new Date(y.updatedAt).getTime() -
                new Date(x.updatedAt).getTime(),
            ),
          );
          setIssueCounts((prev) => ({
            ...prev,
            ...(activeTab === "open"
              ? { open: rows.length }
              : { closed: rows.length }),
          }));
        } else {
          setError("Failed to load issues.");
        }
      })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  }, [session, activeTab]);

  const handleLogout = useCallback(async () => {
    await logoutClientAuthSession();
    router.replace(getPostLogoutLoginPath());
  }, [router]);

  if (session === undefined) return <div style={pageShellStyle}>Loading…</div>;
  if (session === null) return <div style={pageShellStyle}>Redirecting…</div>;

  return (
    <DashboardShell
      title="Order Issues"
      subtitle="Review and resolve scheduling conflicts and cancellation requests."
      leftSectionClassName="min-w-0 min-h-0 lg:flex-[2]"
      rightSectionClassName="min-w-0 min-h-0 lg:flex-[3]"
      leftSectionSurfaceClassName="flex flex-col bg-transparent rounded-none border-0 shadow-none overflow-hidden min-h-0 h-full min-w-0"
      rightSectionSurfaceClassName="flex flex-col bg-transparent rounded-none border-0 shadow-none overflow-hidden min-h-0 h-full min-w-0"
      leftSection={
        <section style={listPanelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Issue list</h2>
              <p style={sectionMetaStyle}>
                Open items need action; closed items are kept for history.
              </p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 0,
              borderBottom: "1px solid #e2e8f0",
              marginBottom: 16,
              flexShrink: 0,
            }}
          >
            {(["open", "closed"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setActiveTab(tab);
                  setIssues([]);
                  setLoading(true);
                  setError(null);
                }}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: activeTab === tab ? 750 : 600,
                  color: activeTab === tab ? "#1e40af" : "#64748b",
                  borderBottom:
                    activeTab === tab
                      ? "2px solid #2563eb"
                      : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {tab === "open"
                  ? `Open (${issueCounts.open})`
                  : `Closed (${issueCounts.closed})`}
              </button>
            ))}
          </div>

          {loading && (
            <p
              style={{
                color: "#64748b",
                fontSize: 13,
                margin: "0 0 12px",
                flexShrink: 0,
              }}
            >
              Loading…
            </p>
          )}
          {error && (
            <p
              style={{
                color: "#991b1b",
                fontSize: 13,
                margin: "0 0 12px",
                flexShrink: 0,
              }}
            >
              {error}
            </p>
          )}
          {!loading && !error && issues.length === 0 && (
            <p
              style={{
                color: "#64748b",
                fontSize: 13,
                margin: 0,
                flexShrink: 0,
              }}
            >
              No {activeTab === "open" ? "open" : "closed"} order issues.
            </p>
          )}

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              marginTop: !loading && issues.length > 0 ? 0 : undefined,
            }}
          >
            {!loading && issues.length > 0 && (
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "#fff",
                }}
              >
                {issues.map((issue, i) => {
                  const selected = issue.number === selectedIssueNumber;
                  return (
                    <button
                      key={issue.id}
                      type="button"
                      onClick={() => openIssue(issue.number)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "14px 16px",
                        border: "none",
                        borderTop: i > 0 ? "1px solid #f1f5f9" : "none",
                        borderLeft: `4px solid ${issue.title.startsWith("Cancellation Request") ? "#f87171" : "#fbbf24"}`,
                        textAlign: "left",
                        font: "inherit",
                        color: "inherit",
                        cursor: "pointer",
                        transition: "background 0.1s",
                        background: selected ? "#eff6ff" : "transparent",
                        boxShadow: selected
                          ? "inset 0 0 0 1px #bfdbfe"
                          : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!selected) {
                          (
                            e.currentTarget as HTMLButtonElement
                          ).style.background = "#f8fafc";
                        }
                      }}
                      onMouseLeave={(e) => {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = selected
                          ? "#eff6ff"
                          : "transparent";
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: "#64748b",
                            fontWeight: 500,
                            whiteSpace: "nowrap",
                          }}
                        >
                          #{issue.number}
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
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
                                fontSize: 14,
                                fontWeight: 600,
                                color: "#0f172a",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {issue.title}
                            </span>
                            <span
                              style={{
                                padding: "1px 6px",
                                borderRadius: 99,
                                fontSize: 10,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                border: "1px solid",
                                ...(issue.title.startsWith(
                                  "Cancellation Request",
                                )
                                  ? {
                                      background: "#fff1f2",
                                      color: "#dc2626",
                                      borderColor: "#fecaca",
                                    }
                                  : {
                                      background: "#fffbeb",
                                      color: "#b45309",
                                      borderColor: "#fde68a",
                                    }),
                              }}
                            >
                              {issue.title.startsWith("Cancellation Request")
                                ? "Cancel"
                                : "Conflict"}
                            </span>
                            <StatusBadge status={issue.status} />
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 12,
                              flexWrap: "wrap",
                              marginTop: 4,
                              fontSize: 12,
                              color: "#64748b",
                            }}
                          >
                            <span>
                              <span style={{ color: "#94a3b8" }}>Order: </span>
                              <span style={{ color: "#334155" }}>
                                {issue.orderName}
                              </span>
                              <span
                                style={{
                                  marginLeft: 4,
                                  padding: "1px 5px",
                                  background: "#f1f5f9",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "#475569",
                                }}
                              >
                                {issue.orderType}
                              </span>
                            </span>
                            <span>
                              <span style={{ color: "#94a3b8" }}>
                                Assignee:{" "}
                              </span>
                              <span style={{ color: "#334155" }}>
                                @{issue.assigneeUsername ?? issue.assigneeEmail}
                              </span>
                            </span>
                            <span>
                              {issue.commentCount} comment
                              {issue.commentCount !== 1 ? "s" : ""}
                            </span>
                            <span>{timeAgo(issue.updatedAt)}</span>
                            {issue.resolution && (
                              <span
                                style={{
                                  padding: "1px 6px",
                                  background: "#f3f4f6",
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "#475569",
                                }}
                              >
                                {issue.resolution.replace("_", " ")}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      }
      rightSection={
        hasValidSelection ? (
          <section style={listPanelStyle}>
            <IssueDetailPanel
              issueNumber={selectedIssueNumber}
              onClear={clearIssue}
            />
          </section>
        ) : (
          <div style={emptyRightStyle}>
            Select an issue from the list to view details and the conversation
            thread.
          </div>
        )
      }
      onBack={handleLogout}
    />
  );
}

export default function ConflictIssuesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
          Loading…
        </div>
      }
    >
      <ConflictIssuesPageContent />
    </Suspense>
  );
}
