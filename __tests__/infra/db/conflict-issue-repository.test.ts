import { describe, it, expect, vi } from "vitest";
import {
  findConflictIssueByNumber,
  findConflictIssues,
  staleOtherProposals,
  ConflictIssueStatus,
} from "@/infra/db/conflict-issue-repository";
import type { PrismaClient } from "@/lib/generated/prisma";

// ---------------------------------------------------------------------------
// findConflictIssueByNumber — orderUpdatedAt regression
//
// The conflict-issue detail UI uses ConflictIssueDetail.orderUpdatedAt as the
// OCC baseline when a sales user posts a proposal. The repository must:
//   1. SELECT order.updatedAt from the DB, AND
//   2. Surface it on the returned object as `orderUpdatedAt`.
//
// Before this fix, `orderUpdatedAt` was not exposed at all and the UI fell
// back to ConflictIssue.updatedAt — causing every Accept to be marked STALE.
// ---------------------------------------------------------------------------

const ORDER_UPDATED_AT = new Date("2026-05-21T08:00:00Z");
const ISSUE_UPDATED_AT = new Date("2026-05-21T08:00:05Z");

function makeMockRow() {
  return {
    id: "ISSUE1",
    number: 101,
    orderId: "O1",
    order: {
      name: "Order One",
      type: "Type A",
      dueDate: new Date("2026-05-20T00:00:00Z"),
      quantity: 1000,
      status: "FAILED",
      updatedAt: ORDER_UPDATED_AT,
    },
    title: "Cannot schedule",
    status: "IN_DISCUSSION",
    resolution: null,
    createdById: "ADMIN1",
    createdBy: { username: "admin-A" },
    assigneeId: "SALES1",
    assignee: { username: "sales-A", email: "sales@example.com" },
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date("2026-05-21T07:59:00Z"),
    updatedAt: ISSUE_UPDATED_AT,
    contextSnapshot: { foo: "bar" },
    _count: { comments: 0 },
    comments: [],
    events: [],
  };
}

describe("findConflictIssueByNumber", () => {
  it("returns orderUpdatedAt from Order.updatedAt (not ConflictIssue.updatedAt)", async () => {
    const findUnique = vi.fn().mockResolvedValue(makeMockRow());
    const mockDb = {
      conflictIssue: { findUnique },
    } as unknown as PrismaClient;

    const result = await findConflictIssueByNumber(mockDb, 101);

    expect(result).not.toBeNull();
    // The whole point of the fix: orderUpdatedAt mirrors Order.updatedAt.
    expect(result!.orderUpdatedAt).toEqual(ORDER_UPDATED_AT);
    // And it is NOT ConflictIssue.updatedAt — these are different rows.
    expect(result!.orderUpdatedAt.getTime()).not.toBe(
      result!.updatedAt.getTime(),
    );
  });

  it("requests order.updatedAt in the Prisma select (so we don't silently drop it)", async () => {
    const findUnique = vi.fn().mockResolvedValue(makeMockRow());
    const mockDb = {
      conflictIssue: { findUnique },
    } as unknown as PrismaClient;

    await findConflictIssueByNumber(mockDb, 101);

    expect(findUnique).toHaveBeenCalledTimes(1);
    const args = findUnique.mock.calls[0][0];
    // Pin the select shape — order.updatedAt must be requested.
    expect(args.select.order.select.updatedAt).toBe(true);
  });

  it("returns null when no issue is found", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const mockDb = {
      conflictIssue: { findUnique },
    } as unknown as PrismaClient;

    const result = await findConflictIssueByNumber(mockDb, 999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findConflictIssues — statuses filter (empty vs non-empty)
// ---------------------------------------------------------------------------

describe("findConflictIssues", () => {
  it("omits status from Prisma where when statuses is undefined", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const mockDb = {
      conflictIssue: { findMany },
    } as unknown as PrismaClient;

    await findConflictIssues(mockDb, {});

    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBeUndefined();
  });

  it("omits status from Prisma where when statuses is [] (no narrowing)", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const mockDb = {
      conflictIssue: { findMany },
    } as unknown as PrismaClient;

    await findConflictIssues(mockDb, { statuses: [] });

    const where = findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBeUndefined();
  });

  it("adds status: { in } when statuses is non-empty", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const mockDb = {
      conflictIssue: { findMany },
    } as unknown as PrismaClient;

    await findConflictIssues(mockDb, {
      statuses: [ConflictIssueStatus.OPEN, ConflictIssueStatus.IN_DISCUSSION],
    });

    const where = findMany.mock.calls[0][0].where as {
      status: { in: ConflictIssueStatus[] };
    };
    expect(where.status).toEqual({
      in: [ConflictIssueStatus.OPEN, ConflictIssueStatus.IN_DISCUSSION],
    });
  });

  it("maps rows via toIssueRow", async () => {
    const findMany = vi.fn().mockResolvedValue([makeMockRow()]);
    const mockDb = {
      conflictIssue: { findMany },
    } as unknown as PrismaClient;

    const rows = await findConflictIssues(mockDb, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "ISSUE1",
      number: 101,
      orderName: "Order One",
      orderType: "Type A",
      status: "IN_DISCUSSION",
      commentCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// staleOtherProposals — PENDING → STALE batch, null skip, empty updates
// ---------------------------------------------------------------------------

describe("staleOtherProposals", () => {
  it("does not call $transaction when there are no PENDING other proposals", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "C2", proposal: null },
        {
          id: "C3",
          proposal: { kind: "DELAY_DUE_DATE", status: "ACCEPTED" },
        },
      ]);
    const update = vi.fn();
    const $transaction = vi.fn();
    const mockDb = {
      conflictIssueComment: { findMany, update },
      $transaction,
    } as unknown as PrismaClient;

    await staleOtherProposals(mockDb, "ISSUE1", "C1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: "ISSUE1", id: { not: "C1" } },
      }),
    );
    expect($transaction).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("marks each other PENDING proposal STALE in a single $transaction", async () => {
    const pendingA = { kind: "DELAY_DUE_DATE", status: "PENDING" as const };
    const pendingB = { kind: "REDUCE_QUANTITY", status: "PENDING" as const };
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "C2", proposal: pendingA },
        { id: "C3", proposal: pendingB },
        { id: "C4", proposal: { status: "STALE" } },
      ]);
    const update = vi.fn().mockResolvedValue(undefined);
    const $transaction = vi.fn().mockResolvedValue(undefined);
    const mockDb = {
      conflictIssueComment: { findMany, update },
      $transaction,
    } as unknown as PrismaClient;

    await staleOtherProposals(mockDb, "ISSUE1", "C99");

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "C2" },
      data: { proposal: { ...pendingA, status: "STALE" } },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "C3" },
      data: { proposal: { ...pendingB, status: "STALE" } },
    });
    expect($transaction).toHaveBeenCalledTimes(1);
    const batch = $transaction.mock.calls[0][0] as unknown[];
    expect(batch).toHaveLength(2);
  });
});
