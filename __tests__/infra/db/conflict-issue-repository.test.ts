import { describe, it, expect, vi } from "vitest";
import { findConflictIssueByNumber } from "@/infra/db/conflict-issue-repository";
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
