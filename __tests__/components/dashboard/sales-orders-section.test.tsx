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

  const BASE_ORDER = {
    id: "O1",
    name: "Alpha Order",
    type: "A",
    status: "PENDING",
    dueDate: "2026-12-31T00:00:00.000Z",
    quantity: 100,
    applicantId: "sales-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastModifiedById: null,
  };

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

  it("renders the New Order button when orders array is empty", () => {
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    const newOrderBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("New Order"),
    );
    expect(newOrderBtn).toBeDefined();
    expect(container.textContent).toContain("My Orders");
  });

  it("renders the order name and status badge", () => {
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[BASE_ORDER]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("Alpha Order");
    expect(container.textContent).toContain("PENDING");
  });

  it("shows Edit button only for PENDING and SCHEDULED orders", () => {
    const pending = { ...BASE_ORDER, id: "O1", status: "PENDING" };
    const completed = {
      ...BASE_ORDER,
      id: "O2",
      status: "COMPLETED",
      name: "Done",
    };
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[pending, completed]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    const editButtons = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Edit",
    );
    expect(editButtons.length).toBe(1);
  });

  it("calls onCreate when the Create Order button is clicked", () => {
    const onCreate = vi.fn();
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={onCreate}
        />,
      );
    });
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("New Order"),
    );
    expect(createBtn).toBeDefined();
    flushSync(() => {
      createBtn?.click();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("shows only matching status when filter is applied", () => {
    const orders = [
      { ...BASE_ORDER, id: "O1", status: "PENDING", name: "Alpha" },
      { ...BASE_ORDER, id: "O2", status: "SCHEDULED", name: "Beta" },
      { ...BASE_ORDER, id: "O3", status: "COMPLETED", name: "Gamma" },
    ];
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={orders}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    const statusSelect = container.querySelector("select") as HTMLSelectElement;
    flushSync(() => {
      statusSelect.value = "SCHEDULED";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).not.toContain("Gamma");
  });

  it("toggles sort direction between Ascending and Descending", () => {
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[BASE_ORDER]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("Ascending");
    const toggleBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Ascending"),
    )!;
    flushSync(() => {
      toggleBtn.click();
    });
    expect(container.textContent).toContain("Descending");
  });

  it("shows result count in filter bar", () => {
    const orders = [
      { ...BASE_ORDER, id: "O1" },
      { ...BASE_ORDER, id: "O2", name: "Beta" },
    ];
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={orders}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("Showing 2 of 2 orders");
  });

  it("changes sort key via the Sort By select", () => {
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={[BASE_ORDER]}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    const selects = container.querySelectorAll("select");
    // Sort By is the 2nd select (after Filter)
    const sortSelect = selects[1] as HTMLSelectElement;
    flushSync(() => {
      sortSelect.value = "name";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(sortSelect.value).toBe("name");
  });

  it("shows all orders when filter is ALL", () => {
    const orders = [
      { ...BASE_ORDER, id: "O1", status: "PENDING" },
      { ...BASE_ORDER, id: "O2", status: "SCHEDULED", name: "Beta" },
    ];
    flushSync(() => {
      root.render(
        <SalesOrdersSection
          orders={orders}
          scheduleByOrderId={new Map()}
          onEdit={vi.fn()}
          onCreate={vi.fn()}
        />,
      );
    });
    expect(container.textContent).toContain("Alpha Order");
    expect(container.textContent).toContain("Beta");
  });
});
