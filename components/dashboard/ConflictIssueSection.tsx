"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";

type IssueRow = {
  id: string;
  number: number;
  orderId: string;
  orderName: string;
  orderType: string;
  title: string;
  status: string;
  resolution: string | null;
  assigneeId: string;
  assigneeUsername: string | null;
  assigneeEmail: string;
  commentCount: number;
  updatedAt: string;
};

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-green-100 text-green-700 border-green-200",
  IN_DISCUSSION: "bg-blue-100 text-blue-700 border-blue-200",
  RESOLVED: "bg-gray-100 text-gray-600 border-gray-200",
  CLOSED: "bg-gray-100 text-gray-600 border-gray-200",
};

function issueKind(title: string): "cancel" | "conflict" {
  return title.startsWith("Cancellation Request") ? "cancel" : "conflict";
}

function KindBadge({ title }: { title: string }) {
  const kind = issueKind(title);
  return kind === "cancel" ? (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold bg-red-50 text-red-600 border-red-200">
      Cancel
    </span>
  ) : (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border-amber-200">
      Conflict
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
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

function apiFetch(path: string) {
  return fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
  });
}

export function ConflictIssueSection() {
  const [activeTab, setActiveTab] = useState<"open" | "closed">("open");
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      const url =
        activeTab === "open"
          ? "/api/conflict-issues?statuses=OPEN,IN_DISCUSSION"
          : "/api/conflict-issues?statuses=RESOLVED,CLOSED";

      try {
        const res = await apiFetch(url);
        if (cancelled) return;
        if (!res.ok) {
          setError("Failed to load conflict issues.");
          setIssues([]);
          return;
        }
        const issuesData = (await res.json()) as IssueRow[];
        setIssues(
          issuesData.sort(
            (x, y) =>
              new Date(y.updatedAt).getTime() - new Date(x.updatedAt).getTime(),
          ),
        );
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  return (
    <>
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Order Issues
        </h2>
        <Link
          href="/conflict-issues"
          className="text-xs font-medium text-blue-700 hover:text-blue-900"
        >
          View all →
        </Link>
      </div>

      <div className="flex gap-0 border-b border-gray-200 px-5">
        {(["open", "closed"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
              activeTab === tab
                ? "text-blue-700 border-blue-700"
                : "text-gray-500 border-transparent hover:text-gray-700"
            }`}
          >
            {tab === "open" ? (
              <>
                <Circle className="h-3 w-3" strokeWidth={2.5} />
                Open
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3" strokeWidth={2.25} />
                Closed
              </>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="p-5 text-center text-xs text-gray-400">Loading…</div>
        )}

        {error && (
          <div className="p-5 text-center text-xs text-red-600">{error}</div>
        )}

        {!loading && !error && issues.length === 0 && (
          <div className="flex-1 flex items-center justify-center p-5">
            <div className="text-center">
              <CheckCircle2
                className="mx-auto mb-2 h-10 w-10 text-gray-300"
                strokeWidth={1.5}
                aria-hidden
              />
              <p className="text-sm text-gray-400">
                No {activeTab === "open" ? "open" : "closed"} order issues
              </p>
            </div>
          </div>
        )}

        {!loading && !error && issues.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className={`border-l-4 ${issueKind(issue.title) === "cancel" ? "border-l-red-400" : "border-l-amber-400"}`}
              >
                <Link
                  href={`/conflict-issues?issue=${issue.number}`}
                  className="block px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap pt-0.5">
                      #{issue.number}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-900 truncate">
                          {issue.title}
                        </span>
                        <KindBadge title={issue.title} />
                        <StatusBadge status={issue.status} />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-gray-500">
                        <span>
                          <span className="text-gray-400">Order: </span>
                          <span className="text-gray-700">
                            {issue.orderName}
                          </span>
                          <span className="ml-1 inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            {issue.orderType}
                          </span>
                        </span>
                        <span>
                          <span className="text-gray-400">Assignee: </span>
                          <span className="text-gray-700">
                            @{issue.assigneeUsername ?? issue.assigneeEmail}
                          </span>
                        </span>
                        <span>
                          {issue.commentCount} comment
                          {issue.commentCount !== 1 ? "s" : ""}
                        </span>
                        <span>{timeAgo(issue.updatedAt)}</span>
                        {issue.resolution && (
                          <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                            {issue.resolution.replace("_", " ")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
