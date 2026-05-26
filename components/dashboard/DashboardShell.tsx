"use client";

import React from "react";
import { AppHeader } from "@/components/dashboard/AppHeader";

export function DashboardShell({
  title,
  subtitle,
  topSection,
  leftSection,
  rightSection,
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
  const hideTop = !!hideTopBar;
  const hideRight = !!hideRightSection;
  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      {!hideTop && <AppHeader title={title} subtitle={subtitle} />}

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
