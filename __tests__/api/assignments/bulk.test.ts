import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/assignments/bulk/route";
import * as auth from "@/modules/auth/require-auth";
import * as manualEditService from "@/modules/schedule/manual-edit-service";

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  CsrfError: class CsrfError extends Error {
    code = "CSRF_ERROR";
    status = 403;
  },
}));

vi.mock("@/modules/schedule/manual-edit-service", () => ({
  applyAssignmentMoves: vi.fn(),
  ManualEditValidationError: class ManualEditValidationError extends Error {
    violations: unknown[];
    constructor(violations: unknown[]) {
      super("Manual edit validation failed");
      this.name = "ManualEditValidationError";
      this.violations = violations;
    }
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

describe("PATCH /api/assignments/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
      requestId: "req-1",
    });
  });

  const validMove = {
    assignmentId: "assign-1",
    factoryId: "factory-A1",
    productionDate: "2026-06-10",
  };

  const createRequest = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/assignments/bulk", {
      method: "PATCH",
      body: JSON.stringify(body),
    });

  it("should return 409 when lock is contended (already running)", async () => {
    vi.mocked(manualEditService.applyAssignmentMoves).mockRejectedValue(
      new Error(
        "A scheduling process is already running for type: A, refresh the page and try again",
      ),
    );

    const res = await PATCH(createRequest({ moves: [validMove] }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("CONFLICT");
  });

  it("should return 409 when version mismatch (environment has changed)", async () => {
    vi.mocked(manualEditService.applyAssignmentMoves).mockRejectedValue(
      new Error(
        "environment has changed: schedule was modified for type A, please reload",
      ),
    );

    const res = await PATCH(createRequest({ moves: [validMove] }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe("CONFLICT");
  });

  it("should return 200 when no expectedVersions provided", async () => {
    vi.mocked(manualEditService.applyAssignmentMoves).mockResolvedValue({
      applied: 1,
    });

    const res = await PATCH(createRequest({ moves: [validMove] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.applied).toBe(1);
  });
});
