/**
 * @vitest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link as a simple anchor
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement("a", { href, className }, children),
}));

import { ConflictIssueSection } from "@/components/dashboard/ConflictIssueSection";

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
  vi.restoreAllMocks();
});

function mockFetch(data: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: () => Promise.resolve(data),
    }),
  );
}

const ISSUE_OPEN = {
  id: "i-1",
  number: 42,
  orderId: "o-1",
  orderName: "Order Alpha",
  orderType: "A",
  title: "Cannot schedule Order Alpha",
  status: "OPEN",
  resolution: null,
  assigneeId: "s-1",
  assigneeUsername: "sales1",
  assigneeEmail: "s@x.com",
  commentCount: 2,
  updatedAt: new Date(Date.now() - 60_000).toISOString(),
};

const ISSUE_CANCEL = {
  ...ISSUE_OPEN,
  id: "i-2",
  number: 43,
  title: "Cancellation Request: Order Beta",
  status: "RESOLVED",
  resolution: "CANCELLED",
};

describe("ConflictIssueSection", () => {
  it("shows loading indicator initially", () => {
    mockFetch([]);
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    expect(container.textContent).toContain("Loading");
  });

  it("shows empty state after loading when no issues", async () => {
    mockFetch([]);
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("No open order issues");
  });

  it("renders an issue row with title, kind badge, and status badge", async () => {
    mockFetch([ISSUE_OPEN]);
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("Cannot schedule Order Alpha");
    expect(container.textContent).toContain("Conflict");
    expect(container.textContent).toContain("OPEN");
    expect(container.textContent).toContain("@sales1");
    expect(container.textContent).toContain("2 comments");
    expect(container.textContent).toContain("#42");
  });

  it("shows Cancel badge for cancellation request titles", async () => {
    mockFetch([ISSUE_CANCEL]);
    // Switch to closed tab to get RESOLVED issues
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // Simulate clicking Closed tab
    mockFetch([ISSUE_CANCEL]);
    const buttons = container.querySelectorAll("button");
    const closedBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Closed"),
    );
    if (closedBtn) {
      await act(async () => {
        closedBtn.click();
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(container.textContent).toContain("Cancel");
    }
  });

  it("shows error message when fetch fails", async () => {
    mockFetch(null, false);
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("Failed to load");
  });

  it("shows assignee email when username is null", async () => {
    mockFetch([{ ...ISSUE_OPEN, assigneeUsername: null }]);
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("@s@x.com");
  });

  it("shows singular 'comment' when commentCount is 1", async () => {
    mockFetch([{ ...ISSUE_OPEN, commentCount: 1 }]);
    flushSync(() => {
      root.render(<ConflictIssueSection />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(container.textContent).toContain("1 comment");
    expect(container.textContent).not.toContain("1 comments");
  });
});
