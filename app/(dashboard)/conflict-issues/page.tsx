"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { AppHeader } from "@/components/dashboard/AppHeader";

function apiFetch(path: string, options: RequestInit = {}) {
  return fetch(path, {
    cache: "no-store",
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
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

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  OPEN: { bg: "#dcfce7", color: "#166534" },
  IN_DISCUSSION: { bg: "#dbeafe", color: "#1e40af" },
  RESOLVED: { bg: "#f3f4f6", color: "#374151" },
  CLOSED: { bg: "#fee2e2", color: "#991b1b" },
};

function StatusBadge({ status }: { status: string }) {
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

export default function ConflictIssuesPage() {
  const router = useRouter();
  const session = useClientAuthSession();

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [router, session]);

  const [activeTab, setActiveTab] = useState<"open" | "closed">("open");
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const url =
      activeTab === "open"
        ? "/api/conflict-issues?statuses=OPEN,IN_DISCUSSION"
        : "/api/conflict-issues?statuses=RESOLVED,CLOSED";

    apiFetch(url)
      .then(async (res) => {
        if (res.ok) {
          const issuesData = (await res.json()) as IssueRow[];
          setIssues(
            issuesData.sort(
              (x, y) =>
                new Date(y.updatedAt).getTime() -
                new Date(x.updatedAt).getTime(),
            ),
          );
        } else {
          setError("Failed to load issues.");
        }
      })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  }, [session, activeTab]);

  if (!session) {
    return (
      <div className="p-10 text-center text-sm text-gray-400">Loading…</div>
    );
  }

  const openCount = issues.filter(
    (i) => i.status === "OPEN" || i.status === "IN_DISCUSSION",
  ).length;
  const closedCount = issues.filter(
    (i) => i.status === "RESOLVED" || i.status === "CLOSED",
  ).length;

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 font-sans">
      <AppHeader
        title="Order Issues"
        subtitle="Track and resolve scheduling conflicts"
      />
      <div className="max-w-4xl mx-auto w-full px-4 py-5">
        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 0,
            borderBottom: "2px solid #e2e8f0",
            marginBottom: 20,
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
                padding: "8px 20px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? "#1e40af" : "#64748b",
                borderBottom:
                  activeTab === tab
                    ? "2px solid #1e40af"
                    : "2px solid transparent",
                marginBottom: -2,
              }}
            >
              {tab === "open"
                ? `● Open (${openCount})`
                : `✓ Closed (${closedCount})`}
            </button>
          ))}
        </div>

        {/* Issue list */}
        {loading && <p style={{ color: "#64748b", fontSize: 14 }}>Loading…</p>}
        {error && <p style={{ color: "#dc2626", fontSize: 14 }}>{error}</p>}
        {!loading && !error && issues.length === 0 && (
          <p style={{ color: "#64748b", fontSize: 14 }}>
            No {activeTab === "open" ? "open" : "closed"} order issues.
          </p>
        )}

        {!loading && issues.length > 0 && (
          <div
            style={{
              border: "1px solid #dbe3ef",
              borderRadius: 8,
              overflow: "hidden",
              background: "#fff",
            }}
          >
            {issues.map((issue, i) => (
              <a
                key={issue.id}
                href={`/conflict-issues/${issue.number}`}
                style={{
                  display: "block",
                  padding: "14px 16px",
                  borderTop: i > 0 ? "1px solid #f1f5f9" : "none",
                  borderLeft: `4px solid ${issue.title.startsWith("Cancellation Request") ? "#f87171" : "#fbbf24"}`,
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.background =
                    "#f8fafc")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLAnchorElement).style.background = "")
                }
              >
                <div
                  style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
                >
                  {/* Issue number + status */}
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
                    {/* Title */}
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
                          ...(issue.title.startsWith("Cancellation Request")
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

                    {/* Meta */}
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
                        <span style={{ color: "#94a3b8" }}>Assignee: </span>
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
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
