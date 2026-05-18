"use client";

import React from "react";

export function MessagesSection() {
  return (
    <>
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Messages
        </h2>
      </div>
      <div className="flex-1 flex items-center justify-center p-5">
        <div className="text-center">
          <div className="text-4xl mb-2">💬</div>
          <p className="text-sm text-gray-400">No messages yet</p>
          <p className="text-xs text-gray-300 mt-1">
            System notifications will appear here
          </p>
        </div>
      </div>
    </>
  );
}
