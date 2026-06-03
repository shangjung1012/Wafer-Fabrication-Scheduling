/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminPendingSection } from "@/components/dashboard/AdminPendingSection";

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
});

function makeRow(
  factoryId: string,
  type: string,
  dateColumns: string[],
  percent = 50,
) {
  return {
    factoryId,
    label: `Factory ${factoryId}`,
    productionType: type,
    totalQuantity: 1000,
    totalOrders: 5,
    cells: dateColumns.map((date) => ({
      date,
      orderCount: 2,
      totalQuantity: 200,
      percent,
    })),
  };
}

const DATES = ["2026-06-03", "2026-06-04", "2026-06-05"];

describe("AdminPendingSection", () => {
  it("renders the 'no data' message when rows is empty", () => {
    flushSync(() => {
      root.render(
        <AdminPendingSection
          rows={[]}
          dateColumns={DATES}
          dateRangeLabel="Jun 3 – Jun 9"
        />,
      );
    });
    expect(container.textContent).toContain("No production data");
  });

  it("renders the header with dateRangeLabel and totals", () => {
    const rows = [makeRow("A1", "A", DATES)];
    flushSync(() => {
      root.render(
        <AdminPendingSection
          rows={rows}
          dateColumns={DATES}
          dateRangeLabel="Jun 3 – Jun 9"
        />,
      );
    });
    expect(container.textContent).toContain("Jun 3 – Jun 9");
    expect(container.textContent).toContain("5"); // totalOrders
  });

  it("renders a table with factory rows when rows are provided", () => {
    const rows = [makeRow("A1", "A", DATES)];
    flushSync(() => {
      root.render(
        <AdminPendingSection
          rows={rows}
          dateColumns={DATES}
          dateRangeLabel=""
        />,
      );
    });
    const tds = container.querySelectorAll("td");
    expect(tds.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Factory A1");
  });

  it("renders production type group headers when rows span multiple types", () => {
    const rows = [makeRow("A1", "A", DATES), makeRow("B1", "B", DATES)];
    flushSync(() => {
      root.render(
        <AdminPendingSection
          rows={rows}
          dateColumns={DATES}
          dateRangeLabel=""
        />,
      );
    });
    expect(container.textContent).toContain("Production Type A");
    expect(container.textContent).toContain("Production Type B");
  });

  it("shows 100% colour for cells at full capacity", () => {
    const rows = [makeRow("A1", "A", DATES, 100)];
    flushSync(() => {
      root.render(
        <AdminPendingSection
          rows={rows}
          dateColumns={DATES}
          dateRangeLabel=""
        />,
      );
    });
    expect(container.textContent).toContain("100%");
  });

  it("falls back to Next 7 days label when dateRangeLabel is empty", () => {
    flushSync(() => {
      root.render(
        <AdminPendingSection rows={[]} dateColumns={DATES} dateRangeLabel="" />,
      );
    });
    expect(container.textContent).toContain("Next 7 days");
  });
});
