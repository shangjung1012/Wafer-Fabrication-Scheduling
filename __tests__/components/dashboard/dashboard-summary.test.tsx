/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DashboardSummary } from "@/components/dashboard/DashboardSummary";

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

describe("DashboardSummary", () => {
  it("shows 'Normal' headline when there are no FAILED orders", () => {
    flushSync(() => {
      root.render(<DashboardSummary statusCounts={{ FAILED: 0 }} />);
    });
    expect(container.textContent).toContain("Normal");
  });

  it("shows singular '1 failed order' headline", () => {
    flushSync(() => {
      root.render(<DashboardSummary statusCounts={{ FAILED: 1 }} />);
    });
    expect(container.textContent).toContain("1 failed order");
  });

  it("shows plural headline for multiple FAILED orders", () => {
    flushSync(() => {
      root.render(<DashboardSummary statusCounts={{ FAILED: 5 }} />);
    });
    expect(container.textContent).toContain("5 failed orders");
  });

  it("renders status counts for PENDING, SCHEDULED, IN_PRODUCTION, COMPLETED", () => {
    flushSync(() => {
      root.render(
        <DashboardSummary
          statusCounts={{
            PENDING: 10,
            SCHEDULED: 20,
            IN_PRODUCTION: 30,
            COMPLETED: 40,
            FAILED: 0,
          }}
        />,
      );
    });
    expect(container.textContent).toContain("10");
    expect(container.textContent).toContain("20");
    expect(container.textContent).toContain("30");
    expect(container.textContent).toContain("40");
  });

  it("renders with default empty statusCounts without crashing", () => {
    flushSync(() => {
      root.render(<DashboardSummary />);
    });
    expect(container.textContent).toContain("Normal");
  });

  it("shows the FAILED subline when there are failed orders", () => {
    flushSync(() => {
      root.render(<DashboardSummary statusCounts={{ FAILED: 3 }} />);
    });
    expect(container.textContent).toContain("FAILED");
  });
});
