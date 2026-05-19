"use client";

import React, { useState } from "react";

type RequestInfo = {
  id: string;
  name: string;
  type: string;
  status: string;
  applicantId: string;
  createdAt: string;
  dueDate: string | null;
  quantity: number;
  lastModifiedById: string | null;
};

export function AdminPendingSection({
  requests,
  onRequestsChange,
}: {
  requests: RequestInfo[];
  onRequestsChange: (updated: RequestInfo[]) => void;
}) {
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleApprove = async (req: RequestInfo) => {
    setActionLoading((s) => ({ ...s, [req.id]: true }));
    setErrors((s) => {
      const c = { ...s };
      delete c[req.id];
      return c;
    });
    try {
      const res = await fetch(`/api/orders/${req.id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SCHEDULED" }),
      });
      if (res.ok) {
        onRequestsChange(requests.filter((r) => r.id !== req.id));
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        setErrors((s) => ({
          ...s,
          [req.id]: body.message ?? body.code ?? "Approve failed.",
        }));
      }
    } catch {
      setErrors((s) => ({ ...s, [req.id]: "Network error." }));
    } finally {
      setActionLoading((s) => {
        const copy = { ...s };
        delete copy[req.id];
        return copy;
      });
    }
  };

  const handleReject = async (req: RequestInfo) => {
    setActionLoading((s) => ({ ...s, [req.id]: true }));
    setErrors((s) => {
      const c = { ...s };
      delete c[req.id];
      return c;
    });
    try {
      const res = await fetch(`/api/orders/${req.id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (res.ok) {
        onRequestsChange(requests.filter((r) => r.id !== req.id));
      } else {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        setErrors((s) => ({
          ...s,
          [req.id]: body.message ?? body.code ?? "Reject failed.",
        }));
      }
    } catch {
      setErrors((s) => ({ ...s, [req.id]: "Network error." }));
    } finally {
      setActionLoading((s) => {
        const copy = { ...s };
        delete copy[req.id];
        return copy;
      });
    }
  };

  return (
    <>
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          待處理申請 (Pending Requests)
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {requests.length === 0 ? (
          <p className="text-sm text-gray-400 text-center mt-10">
            No pending requests.
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <div
                key={req.id}
                className="border border-gray-100 rounded-lg p-3 hover:border-blue-200 transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold text-gray-800 text-sm">
                    {req.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                      {req.type}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={!!actionLoading[req.id]}
                        onClick={() => handleApprove(req)}
                        className="text-xs font-medium px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={!!actionLoading[req.id]}
                        onClick={() => handleReject(req)}
                        className="text-xs font-medium px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Applicant:</span>
                    <span className="font-mono text-gray-700">
                      {req.applicantId}
                    </span>
                  </div>
                  {req.dueDate && (
                    <div className="flex justify-between">
                      <span>Due Date:</span>
                      <span className="font-medium text-gray-700">
                        {req.dueDate}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Created:</span>
                    <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {errors[req.id] && (
                  <p className="text-xs text-red-600 mt-2">{errors[req.id]}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
