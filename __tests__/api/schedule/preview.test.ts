import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/schedule/preview/route";
import * as auth from "@/modules/auth/require-auth";
import { resolveActorScope } from "@/modules/auth/scope";
import * as schedulePreview from "@/modules/schedule/preview";
import * as scheduleStore from "@/infra/redis/schedule-store";
import { OrderStatus, AssignmentStatus } from "@/lib/generated/prisma";
import crypto from "crypto";

vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  CsrfError: class CsrfError extends Error {
    code = "CSRF_ERROR";
    status = 403;
  },
}));

vi.mock("@/modules/auth/scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/auth/scope")>();
  return {
    ...actual,
    resolveActorScope: vi.fn(),
  };
});

vi.mock("@/modules/schedule/preview", () => ({
  previewSchedule: vi.fn(),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  getScheduleVersion: vi.fn(),
  setPreview: vi.fn(),
}));

// Mock crypto
vi.mock("crypto", () => ({
  default: {
    randomUUID: vi.fn(),
  },
}));

describe("POST /api/schedule/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveActorScope).mockResolvedValue({
      role: "ADMIN",
      userId: "U1",
      factoryIds: ["factory-A1"],
      productionType: "A",
      group: "A",
    });
  });

  const createRequest = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/schedule/preview", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("should return 403 for non-admins", async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "SALES", id: "U1" },
      requestId: "req-1",
    });

    const res = await POST(createRequest({ type: "A" }));
    expect(res.status).toBe(403);
  });

  it("should return 403 when an admin previews another production type", async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
      requestId: "req-1",
    });
    vi.mocked(resolveActorScope).mockResolvedValueOnce({
      role: "ADMIN",
      userId: "U1",
      factoryIds: ["factory-A1"],
      productionType: "A",
      group: "A",
    });

    const res = await POST(createRequest({ type: "B" }));

    expect(res.status).toBe(403);
    expect(schedulePreview.previewSchedule).not.toHaveBeenCalled();
  });

  it("should generate a preview, save it to redis, and format the response correctly", async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
      requestId: "req-1",
    });

    const mockDate = new Date("2024-01-01T00:00:00.000Z");
    const mockStrategyResult = {
      processedOrders: [
        {
          id: "O1",
          status: OrderStatus.SCHEDULED,
          assignments: [
            {
              id: "existing",
              orderId: "O1",
              factoryId: "F1",
              status: AssignmentStatus.SCHEDULED,
              productionDate: mockDate,
              assignedQuantity: 50,
            },
          ],
        },
        { id: "O2", status: OrderStatus.FAILED, quantity: 100 },
      ],
      newAssignments: [
        {
          orderId: "O1",
          factoryId: "F2",
          productionDate: mockDate,
          assignedQuantity: 50,
          status: AssignmentStatus.SCHEDULED,
        },
      ],
      updatedCapacities: [],
      newCapacities: [],
    };

    vi.mocked(schedulePreview.previewSchedule).mockResolvedValue(
      mockStrategyResult as unknown as Awaited<
        ReturnType<typeof schedulePreview.previewSchedule>
      >,
    );
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(5);
    vi.mocked(crypto.randomUUID).mockReturnValue(
      "123e4567-e89b-12d3-a456-426614174000",
    );

    const reqBody = {
      type: "A",
      config: {
        startDate: mockDate.toISOString(),
      },
    };

    const res = await POST(createRequest(reqBody));
    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.previewId).toBe("123e4567-e89b-12d3-a456-426614174000");

    // Check hydration
    expect(data.data.newSchedule).toHaveLength(2);
    expect(data.data.newSchedule[0].id).toBe("O1");
    // O1 should have the old assignment + the new assignment
    expect(data.data.newSchedule[0].assignments).toHaveLength(2);
    expect(data.data.newSchedule[0].assignments[1].factoryId).toBe("F2");

    expect(data.data.affectedOrders).toContain("O1");
    expect(data.data.affectedOrders).toContain("O2");

    // O2 is FAILED, which means it failed to schedule.
    expect(data.data.failedOrderIds).toEqual(["O2"]);
  });

  it("should extract failedOrderIds correctly when order is FAILED", async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
      requestId: "req-1",
    });

    const mockDate = new Date("2024-01-01T00:00:00.000Z");
    const mockStrategyResult = {
      processedOrders: [
        {
          id: "O1",
          status: OrderStatus.SCHEDULED,
          assignments: [],
        },
        { id: "O2", status: OrderStatus.FAILED, quantity: 100 },
      ],
      newAssignments: [],
      updatedCapacities: [],
      newCapacities: [],
    };

    vi.mocked(schedulePreview.previewSchedule).mockResolvedValue(
      mockStrategyResult as unknown as Awaited<
        ReturnType<typeof schedulePreview.previewSchedule>
      >,
    );
    vi.mocked(scheduleStore.getScheduleVersion).mockResolvedValue(5);
    vi.mocked(crypto.randomUUID).mockReturnValue(
      "123e4567-e89b-12d3-a456-426614174000",
    );

    const reqBody = {
      type: "A",
      config: {
        startDate: mockDate.toISOString(),
      },
    };

    const res = await POST(createRequest(reqBody));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.data.failedOrderIds).toEqual(["O2"]);
  });
});
