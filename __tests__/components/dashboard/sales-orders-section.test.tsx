/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SalesOrdersSection } from "@/components/dashboard/SalesOrdersSection";

describe("SalesOrdersSection", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  it("shows FAILED orders and lets users filter by FAILED status", () => {
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[
            {
              id: "O1",
              name: "Failed order",
              type: "A",
              status: "FAILED",
              dueDate: "2026-12-31T00:00:00.000Z",
              quantity: 100,
              applicantId: "sales-1",
              createdAt: "2026-01-01T00:00:00.000Z",
              lastModifiedById: null,
            },
          ]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });

    const statusFilter = Array.from(container.querySelectorAll("select")).find(
      (select) =>
        Array.from(select.options).some((option) => option.value === "FAILED"),
    );

    expect(container.textContent).toContain("FAILED");
    expect(statusFilter).toBeDefined();
  });
});
