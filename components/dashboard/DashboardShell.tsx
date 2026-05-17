"use client";

import React from "react";

export function DashboardShell({
  title,
  subtitle,
  topSection,
  leftSection,
  rightSection,
  onBack,
}: {
  title: string;
  subtitle: string;
  topSection: React.ReactNode;
  leftSection: React.ReactNode;
  rightSection: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      {/* Top bar */}
      <div className="flex-none bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
          </div>
          <button
            onClick={onBack}
            className="text-xs font-medium px-3 py-1.5 rounded border border-gray-200 bg-white text-gray-600 hover:text-gray-900"
          >
            Back to Visualization
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {/* Top section */}
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          {topSection}
        </section>

        {/* Bottom split layout */}
        <div className="flex flex-1 gap-6 min-h-0">
          {/* Left section: 2/3 width */}
          <div className="flex-[2] flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {leftSection}
          </div>

          {/* Right section: 1/3 width */}
          <div className="flex-1 flex flex-col bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {rightSection}
          </div>
        </div>
      </div>
    </div>
  );
}
