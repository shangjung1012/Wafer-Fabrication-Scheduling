import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/conflict-issues/route";
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import * as conflictIssueService from "@/modules/order/conflict-issue-service";
import { ConflictIssueStatus } from "@/infra/db/conflict-issue-repository";

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  CsrfError: class CsrfError extends Error {
    status = 403;
    code = "CSRF_FORBIDDEN";
  },
  UnauthorizedError: class UnauthorizedError extends Error {
    status = 401;
    code = "UNAUTHORIZED";
  },
}));

vi.mock("@/modules/order/conflict-issue-service", () => ({
  listConflictIssues: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { __tag: "mock-prisma" },
}));

describe("GET /api/conflict-issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({
      requestId: "test-req",
      user: { id: "user-1", role: "SALES", username: "sales-1" },
    });
    vi.mocked(conflictIssueService.listConflictIssues).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new UnauthorizedError());
    const req = new NextRequest("http://localhost:3000/api/conflict-issues");
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(conflictIssueService.listConflictIssues).not.toHaveBeenCalled();
  });

  it("passes statuses OPEN,IN_DISCUSSION to listConflictIssues", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/conflict-issues?statuses=OPEN,IN_DISCUSSION",
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(conflictIssueService.listConflictIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ __tag: "mock-prisma" }),
      {
        statuses: [ConflictIssueStatus.OPEN, ConflictIssueStatus.IN_DISCUSSION],
      },
    );
  });

  it("filters invalid status tokens and keeps valid enum values", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/conflict-issues?statuses=NOT_A_STATUS,OPEN,RESOLVED",
    );
    await GET(req);
    expect(conflictIssueService.listConflictIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        statuses: [ConflictIssueStatus.OPEN, ConflictIssueStatus.RESOLVED],
      },
    );
  });

  it("passes empty statuses array when query param is only invalid tokens", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/conflict-issues?statuses=FOO,BAR",
    );
    await GET(req);
    expect(conflictIssueService.listConflictIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { statuses: [] },
    );
  });

  it("omits statuses in service args when query param absent", async () => {
    const req = new NextRequest("http://localhost:3000/api/conflict-issues");
    await GET(req);
    expect(conflictIssueService.listConflictIssues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { statuses: undefined },
    );
  });
});
