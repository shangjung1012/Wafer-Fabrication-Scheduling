import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/schedule/preview/route";
import * as auth from "@/modules/auth/require-auth";
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
  });

  const createRequest = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/schedule/preview", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("should return 403 for non-admins", async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "SALES", id: "U1" },
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

    const res = await POST(createRequest({ type: "Type A" }));
    expect(res.status).toBe(403);
  });

  it("should generate a preview, save it to redis, and format the response correctly", async () => {
    vi.mocked(auth.requireAuth).mockResolvedValue({
      user: { role: "ADMIN", id: "U1" },
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

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
      conflictOrderIds: [],
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
      type: "Type A",
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
    } as unknown as Awaited<ReturnType<typeof auth.requireAuth>>);

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
      conflictOrderIds: [],
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
      type: "Type A",
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
