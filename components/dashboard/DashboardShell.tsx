"use client";

import React from "react";
import Link from "next/link";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { logoutClientAuthSession } from "@/modules/auth/client-session";

export function DashboardShell({
  title,
  subtitle,
  topSection,
  leftSection,
  rightSection,
  onBack,
  hideTopBar,
  hideRightSection,
}: {
  title: string;
  subtitle: string;
  topSection?: React.ReactNode;
  leftSection: React.ReactNode;
  rightSection?: React.ReactNode;
  onBack: () => void;
  hideTopBar?: boolean;
  hideRightSection?: boolean;
}) {
  const session = useClientAuthSession();
  const hideTop = !!hideTopBar;
  const hideRight = !!hideRightSection;
  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      {/* Top bar */}
      {!hideTop && (
        <div className="flex-none bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{title}</h1>
              <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
            </div>

            {/* Navigation + session (match visualization bar) */}
            <nav
              className="flex items-center gap-2 flex-wrap"
              aria-label="Dashboard navigation"
            >
              <Link
                href="/conflict-issues"
                className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              >
                Issues
              </Link>
              <Link
                href="/visualization"
                className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              >
                Visualization
              </Link>
              <Link
                href="/visualization/dashboard"
                className="text-xs font-medium px-2.5 py-1.5 rounded border border-blue-200 bg-blue-50 text-blue-700"
              >
                Dashboard
              </Link>
              {session && session.user.role === "SUPERADMIN" && (
                <Link
                  href="/permissions"
                  className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
                >
                  Permissions
                </Link>
              )}
              <Link
                href="/profile"
                className="text-xs font-medium px-2.5 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
              >
                Profile
              </Link>
            </nav>

            <SessionBox onBack={onBack} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {!hideTop && topSection ? (
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            {topSection}
          </section>
        ) : null}

        {/* Bottom split layout */}
        <div className="flex flex-1 gap-6 min-h-0">
          {/* Left section: wide when right hidden, otherwise 2/3 width */}
          <div
            className={`${hideRight ? "flex-1" : "flex-[2]"} flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden`}
          >
            {leftSection}
          </div>

          {/* Right section: render only when not hidden */}
          {!hideRight && (
            <div className="flex-1 flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              {rightSection}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionBox({ onBack }: { onBack: () => void }) {
  const session = useClientAuthSession();
  const productionType = undefined; // kept for parity with visualization UI

  const handleLogout = async () => {
    await logoutClientAuthSession();
    // navigate to login; pages using DashboardShell should handle redirect when session clears
    onBack();
  };

  if (session === undefined) return null;
  if (session === null) return null;

  return (
    <div className="flex items-center gap-2 border border-gray-200 rounded px-2 py-1 bg-gray-50">
      <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
        Signed in as:
      </span>
      <span className="text-xs font-semibold text-gray-800">
        {session.user.username}
      </span>
      <span className="text-xs text-gray-500">({session.user.email})</span>
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
        {session.user.role}
      </span>
      {productionType && (
        <span className="text-xs text-gray-500">Type {productionType}</span>
      )}
      <button
        type="button"
        onClick={handleLogout}
        className="text-xs font-medium px-2 py-1 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
      >
        Logout
      </button>
    </div>
  );
}
