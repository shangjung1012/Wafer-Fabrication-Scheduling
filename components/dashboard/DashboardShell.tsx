"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useClientAuthSession } from "@/modules/auth/use-client-auth-session";
import { logoutClientAuthSession } from "@/modules/auth/client-session";

export function DashboardShell({
  title,
  subtitle,
  topSection,
  leftSection,
  rightSection,
  leftSectionClassName,
  rightSectionClassName,
  leftSectionSurfaceClassName,
  rightSectionSurfaceClassName,
  onBack,
  hideTopBar,
  hideRightSection,
}: {
  title: string;
  subtitle: string;
  topSection?: React.ReactNode;
  leftSection: React.ReactNode;
  rightSection?: React.ReactNode;
  leftSectionClassName?: string;
  rightSectionClassName?: string;
  leftSectionSurfaceClassName?: string;
  rightSectionSurfaceClassName?: string;
  onBack: () => void;
  hideTopBar?: boolean;
  hideRightSection?: boolean;
}) {
  const session = useClientAuthSession();
  const pathname = usePathname();
  const hideTop = !!hideTopBar;
  const hideRight = !!hideRightSection;
  const isVisDashboard = pathname?.startsWith("/visualization/dashboard");
  const isVisualization = pathname?.startsWith("/visualization");
  return (
    <div className="flex min-h-dvh flex-col bg-gray-50 font-sans lg:h-screen">
      {/* Top bar */}
      {!hideTop && (
        <div className="flex-none border-b border-gray-200 bg-white px-3 py-3 sm:px-4 lg:px-6 lg:py-4">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 overflow-hidden lg:w-80 lg:flex-shrink-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">
                {title}
              </h1>
              <p className="text-sm text-gray-500 mt-1 truncate">{subtitle}</p>
            </div>
            {/* Navigation + session (underline-style tabs) */}
            <div className="-mx-3 min-w-0 overflow-x-auto px-3 sm:-mx-4 sm:px-4 lg:mx-0 lg:flex lg:flex-1 lg:items-center lg:justify-center lg:overflow-visible lg:px-0">
              <nav
                className="flex min-w-max items-center gap-1.5 lg:min-w-0 lg:flex-wrap lg:gap-2"
                aria-label="Dashboard navigation"
              >
                {/* Order: Schedule, Dashboard, Issues, Permissions (superadmin), Profile */}
                <Link
                  href="/visualization"
                  className={`text-sm font-medium px-3 py-2 ${
                    isVisualization && !isVisDashboard
                      ? "text-blue-700 border-b-2 border-blue-700"
                      : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
                  }`}
                >
                  Schedule
                </Link>

                <Link
                  href="/visualization/dashboard"
                  className={`text-sm font-medium px-3 py-2 ${
                    isVisDashboard
                      ? "text-blue-700 border-b-2 border-blue-700"
                      : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
                  }`}
                >
                  Dashboard
                </Link>

                <Link
                  href="/conflict-issues"
                  className={`text-sm font-medium px-3 py-2 ${
                    pathname?.startsWith("/conflict-issues")
                      ? "text-blue-700 border-b-2 border-blue-700"
                      : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
                  }`}
                >
                  Issues
                </Link>

                {session && session.user.role === "SUPERADMIN" && (
                  <Link
                    href="/permissions"
                    className={`text-sm font-medium px-3 py-2 ${
                      pathname?.startsWith("/permissions")
                        ? "text-blue-700 border-b-2 border-blue-700"
                        : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
                    }`}
                  >
                    Permissions
                  </Link>
                )}

                <Link
                  href="/profile"
                  className={`text-sm font-medium px-3 py-2 ${
                    pathname?.startsWith("/profile")
                      ? "text-blue-700 border-b-2 border-blue-700"
                      : "text-gray-600 hover:text-gray-900 border-b-2 border-transparent"
                  }`}
                >
                  Profile
                </Link>
              </nav>
            </div>

            <SessionBox onBack={onBack} />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-3 sm:p-4 lg:gap-6 lg:p-6">
        {!hideTop && topSection ? (
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            {topSection}
          </section>
        ) : null}

        {/* Bottom split layout */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-6">
          {/* Left section: wide when right hidden, otherwise 2/3 width */}
          <div
            className={`min-w-0 w-full ${leftSectionClassName ?? (hideRight ? "flex-1" : "lg:flex-[2]")} ${leftSectionSurfaceClassName ?? "flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"}`}
          >
            {leftSection}
          </div>

          {/* Right section: render only when not hidden */}
          {!hideRight && (
            <div
              className={`min-w-0 w-full ${rightSectionClassName ?? "lg:flex-1"} ${rightSectionSurfaceClassName ?? "flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"}`}
            >
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
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-gray-200 bg-gray-50 px-2 py-1 lg:max-w-[36rem] lg:flex-nowrap">
      <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
        Signed in as:
      </span>
      <span className="min-w-0 truncate text-xs font-semibold text-gray-800">
        {session.user.username}
      </span>
      <span className="min-w-0 max-w-full truncate text-xs text-gray-500 lg:max-w-52">
        ({session.user.email})
      </span>
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
