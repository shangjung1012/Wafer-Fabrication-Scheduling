/**
 * @vitest-environment jsdom
 */
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: undefined as
    | undefined
    | null
    | { user: { id: string; role: "ADMIN" | "SUPERADMIN" | "SALES" } },
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/modules/auth/use-client-auth-session", () => ({
  useClientAuthSession: () => mocks.session,
}));

import { IssueDetailPanel } from "@/components/conflict-issues/IssueDetailPanel";

const now = new Date("2026-06-03T10:00:00.000Z");
const createdAt = new Date(now.getTime() - 5 * 60_000).toISOString();

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    number: 42,
    orderId: "order-1",
    orderName: "Order Alpha",
    orderType: "A",
    title: "Capacity shortage for Order Alpha",
    status: "OPEN",
    resolution: null,
    createdById: "admin-1",
    createdByUsername: "admin",
    assigneeId: "sales-1",
    assigneeUsername: "sales",
    assigneeEmail: "sales@example.com",
    resolvedAt: null,
    closedAt: null,
    createdAt,
    updatedAt: createdAt,
    contextSnapshot: {
      reschedulePolicy: "forward",
      windowStart: "2026-06-01",
      windowEnd: "2026-06-05",
      requiredQuantity: 100,
      totalAvailableInWindow: 65,
      deficit: 35,
      factoriesConsidered: [
        { id: "factory-a", productionType: "Type A", maxCapacity: 80 },
        { id: "factory-b", productionType: "Type B", maxCapacity: 60 },
      ],
      orderSnapshot: {
        quantity: 100,
        dueDate: "2026-06-05",
        status: "FAILED",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    },
    commentCount: 2,
    orderDueDate: "2026-06-05T00:00:00.000Z",
    orderQuantity: 100,
    orderStatus: "FAILED",
    orderUpdatedAt: "2026-06-02T00:00:00.000Z",
    timeline: [
      {
        kind: "event",
        id: "event-1",
        issueId: "issue-1",
        actorId: "admin-1",
        actorUsername: null,
        type: "OPENED",
        payload: {},
        createdAt,
      },
      {
        kind: "comment",
        id: "comment-1",
        issueId: "issue-1",
        authorId: "admin-1",
        authorUsername: "admin",
        authorEmail: "admin@example.com",
        authorRole: "ADMIN",
        body: "Reduce this order to fit the original window.",
        proposal: {
          proposal: { kind: "REDUCE_QUANTITY", newQuantity: 65 },
          expectedOrderUpdatedAt: "2026-06-02T00:00:00.000Z",
          status: "PENDING",
        },
        editedAt: "2026-06-03T09:57:00.000Z",
        createdAt,
      },
      {
        kind: "comment",
        id: "comment-2",
        issueId: "issue-1",
        authorId: "sales-1",
        authorUsername: null,
        authorEmail: "sales@example.com",
        authorRole: "SALES",
        body: "I can discuss with the customer.",
        proposal: {
          proposal: { kind: "DELAY_DUE_DATE", newDueDate: "2026-06-10" },
          expectedOrderUpdatedAt: "2026-06-02T00:00:00.000Z",
          status: "ACCEPTED",
        },
        editedAt: null,
        createdAt,
      },
    ],
    ...overrides,
  };
}

const suggestions = {
  computedAt: createdAt,
  scenarios: {
    maxFitInOriginalWindow: {
      quantity: 65,
      originalDueDate: "2026-06-05",
    },
    earliestFitForOriginalQty: {
      dueDate: "2026-06-10",
      daysDelayed: 5,
      searchHorizonDays: 30,
    },
  },
  caveat: "Suggestions are based on current capacity only.",
};

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response;
}

function errorJson(status: number, data: unknown) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

function mockApi(
  issue = makeIssue(),
  options: {
    issueResponse?: Response;
    patchResponse?: Response;
    suggestionsResponse?: Response;
    commentsResponse?: Response;
    throwOnIssue?: boolean;
    throwOnSuggestions?: boolean;
  } = {},
) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      calls.push({ path, init });

      if (path === "/api/conflict-issues/42") {
        if (options.throwOnIssue) throw new Error("issue request failed");
        if (init?.method === "PATCH") {
          return options.patchResponse ?? okJson(issue);
        }
        return options.issueResponse ?? okJson(issue);
      }
      if (path === "/api/conflict-issues/42/suggestions") {
        if (options.throwOnSuggestions) {
          throw new Error("suggestions request failed");
        }
        return options.suggestionsResponse ?? okJson(suggestions);
      }
      if (path === "/api/conflict-issues/42/comments") {
        return options.commentsResponse ?? okJson({ id: "comment-3" });
      }
      if (path === "/api/conflict-issues/42/comments/comment-1/accept") {
        return okJson({ ok: true });
      }
      if (path === "/api/conflict-issues/42/comments/comment-1/reject") {
        return errorJson(409, { error: "Proposal is stale." });
      }
      return errorJson(404, { error: "not found" });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

beforeEach(() => {
  mocks.session = { user: { id: "sales-1", role: "SALES" } };
  mocks.replace.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IssueDetailPanel", () => {
  it("shows auth loading and redirects unauthenticated users", async () => {
    mocks.session = undefined;
    const { rerender } = render(<IssueDetailPanel issueNumber={42} />);
    expect(screen.getByText("Loading…")).toBeTruthy();

    mocks.session = null;
    rerender(<IssueDetailPanel issueNumber={42} />);

    expect(screen.getByText("Redirecting…")).toBeTruthy();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  });

  it("renders the issue header, timeline, sidebar metadata, and suggestions", async () => {
    mockApi();

    render(<IssueDetailPanel issueNumber={42} />);

    expect(await screen.findByText(/Capacity shortage/)).toBeTruthy();
    expect(screen.getByText("OPEN")).toBeTruthy();
    expect(screen.getByText(/opened this issue/)).toBeTruthy();
    expect(
      screen.getByText("Reduce this order to fit the original window."),
    ).toBeTruthy();
    expect(screen.getByText(/Reduce quantity/)).toBeTruthy();
    expect(screen.getByText(/Delay due date/)).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(screen.getByText("ORDER")).toBeTruthy();
    expect(screen.getByText("CONFLICT CONTEXT")).toBeTruthy();
    expect(screen.getAllByText("65").length).toBeGreaterThan(0);
    expect(
      await screen.findByText(/Suggestions are based on current capacity only/),
    ).toBeTruthy();
  });

  it("shows load failures for missing and failed issues", async () => {
    mockApi(makeIssue(), {
      issueResponse: errorJson(404, { error: "missing" }),
    });

    render(<IssueDetailPanel issueNumber={42} />);
    expect(await screen.findByText("Issue not found.")).toBeTruthy();

    cleanup();
    mockApi(makeIssue(), {
      issueResponse: errorJson(500, { error: "database down" }),
    });
    render(<IssueDetailPanel issueNumber={42} />);
    expect(await screen.findByText("Failed to load issue.")).toBeTruthy();

    cleanup();
    mockApi(makeIssue(), { throwOnIssue: true });
    render(<IssueDetailPanel issueNumber={42} />);
    expect(await screen.findByText("Network error.")).toBeTruthy();
  });

  it("shows suggestion errors and omits earliest-fit details when none exist", async () => {
    mockApi(makeIssue(), {
      suggestionsResponse: errorJson(503, { error: "busy" }),
    });

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);
    expect(await screen.findByText("Failed to load suggestions.")).toBeTruthy();

    cleanup();
    mockApi(makeIssue(), {
      suggestionsResponse: okJson({
        ...suggestions,
        scenarios: {
          ...suggestions.scenarios,
          earliestFitForOriginalQty: null,
        },
      }),
    });
    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);
    expect(await screen.findByText(/Max schedulable/)).toBeTruthy();
    expect(screen.queryByText("Keep original quantity")).toBeNull();
  });

  it("posts a plain comment and reloads the issue", async () => {
    const { calls } = mockApi();

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), {
      target: { value: "Thanks, I will follow up." },
    });
    fireEvent.click(screen.getByText("Comment"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/conflict-issues/42/comments" &&
            call.init?.method === "POST" &&
            String(call.init.body).includes("Thanks, I will follow up."),
        ),
      ).toBe(true);
    });
  });

  it("validates and posts structured sales delay proposals", async () => {
    const { calls } = mockApi();

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), {
      target: { value: "Customer can wait." },
    });
    fireEvent.click(screen.getByText(/Add structured proposal/));
    fireEvent.click(screen.getByLabelText("Delay due date"));
    fireEvent.change(screen.getByDisplayValue(""), {
      target: { value: "2026-06-04" },
    });
    fireEvent.click(screen.getByText("Comment"));

    expect(screen.getByText(/New due date must be after/)).toBeTruthy();

    fireEvent.change(screen.getByDisplayValue("2026-06-04"), {
      target: { value: "2026-06-10" },
    });
    fireEvent.click(screen.getByText("Comment"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/conflict-issues/42/comments" &&
            String(call.init?.body).includes("DELAY_DUE_DATE") &&
            String(call.init?.body).includes("2026-06-10"),
        ),
      ).toBe(true);
    });
  });

  it("validates and posts reduce-quantity proposals", async () => {
    const { calls } = mockApi();

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), {
      target: { value: "Reduce to the capacity cap." },
    });
    fireEvent.click(screen.getByText(/Add structured proposal/));
    fireEvent.click(screen.getByText("Comment"));
    expect(screen.getByText("Please enter a valid quantity.")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("New quantity"), {
      target: { value: "55" },
    });
    fireEvent.click(screen.getByText("Comment"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/conflict-issues/42/comments" &&
            String(call.init?.body).includes("REDUCE_QUANTITY") &&
            String(call.init?.body).includes('"newQuantity":55'),
        ),
      ).toBe(true);
    });
  });

  it("posts cancel proposals", async () => {
    const { calls } = mockApi();

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    fireEvent.change(screen.getByPlaceholderText(/Leave a comment/), {
      target: { value: "Customer approved cancellation." },
    });
    fireEvent.click(screen.getByText(/Add structured proposal/));
    fireEvent.click(screen.getByLabelText("Cancel order"));
    fireEvent.click(screen.getByText("Comment"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/conflict-issues/42/comments" &&
            String(call.init?.body).includes('"kind":"CANCEL"'),
        ),
      ).toBe(true);
    });
  });

  it("handles proposal accept failures and refreshes suggestions", async () => {
    const { calls } = mockApi();

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    fireEvent.click(screen.getByText(/Reject/));
    expect(await screen.findByText("Proposal is stale.")).toBeTruthy();

    fireEvent.click(screen.getByText("✓ Accept"));
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/conflict-issues/42/comments/comment-1/accept",
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByText("↻"));
    await waitFor(() => {
      expect(
        calls.filter(
          (call) => call.path === "/api/conflict-issues/42/suggestions",
        ).length,
      ).toBeGreaterThan(1);
    });
  });

  it("shows closed issue copy and admin actions", async () => {
    mocks.session = { user: { id: "admin-2", role: "ADMIN" } };
    const { calls } = mockApi(makeIssue({ status: "RESOLVED" }));

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    expect(
      screen.getByText("This issue is resolved. Reopen it to add comments."),
    ).toBeTruthy();
    expect(screen.getByText("Reopen issue")).toBeTruthy();

    const input = screen.getByPlaceholderText("SALES user ID");
    fireEvent.change(input, { target: { value: "sales-2" } });
    fireEvent.click(screen.getByText("OK"));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.init?.method === "PATCH" &&
            String(call.init.body).includes("REASSIGN") &&
            String(call.init.body).includes("sales-2"),
        ),
      ).toBe(true);
    });
  });

  it("surfaces admin cancel-order failures", async () => {
    mocks.session = { user: { id: "admin-2", role: "ADMIN" } };
    mockApi(makeIssue(), {
      patchResponse: errorJson(409, { error: "Order was already completed." }),
    });

    render(<IssueDetailPanel issueNumber={42} />);
    await screen.findByText(/Capacity shortage/);

    fireEvent.click(screen.getByText("Cancel order"));
    expect(
      await screen.findByText("Order was already completed."),
    ).toBeTruthy();
  });
});
