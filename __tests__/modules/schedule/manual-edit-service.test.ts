import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyAssignmentMoves,
  ManualEditValidationError,
  AssignmentMove,
} from "@/modules/schedule/manual-edit-service";
import { prisma } from "@/lib/prisma";
import * as assignmentRepo from "@/infra/db/assignment-repository";
import * as orderRepo from "@/infra/db/order-repository";
import * as autoSchedulerConfigRepo from "@/infra/db/auto-scheduler-config-repository";
import * as factoryRepo from "@/infra/db/factory-repository";

import * as capacityRepo from "@/infra/db/capacity-repository";
import * as store from "@/infra/redis/schedule-store";
import { AssignmentStatus, OrderStatus } from "@/lib/generated/prisma";

const mockTx = {
  order: {
    updateMany: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (callback) => callback(mockTx)),
    factory: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    autoSchedulerConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    order: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/infra/db/assignment-repository", () => ({
  findAssignmentsByIds: vi.fn(),
  updateAssignmentSlot: vi.fn(),
  createAssignments: vi.fn(),
}));

vi.mock("@/infra/db/order-repository", () => ({
  findOrderById: vi.fn(),
  bulkUpdateOrderStatusAndModifiedBy: vi.fn(),
  bulkUpdateOrderModifiedBy: vi.fn(),
}));

vi.mock("@/infra/db/factory-repository", () => ({
  findFactoriesMaxCapacity: vi.fn(),
}));

vi.mock("@/infra/db/auto-scheduler-config-repository", () => ({
  getOperatingAutoSchedulerConfigs: vi.fn(),
  getAutoSchedulerConfigByType: vi.fn(),
}));

vi.mock("@/infra/db/capacity-repository", () => ({
  findDailyCapacity: vi.fn(),
  upsertDailyCapacityDelta: vi.fn(),
}));

vi.mock("@/infra/redis/schedule-store", () => ({
  withScheduleLock: vi.fn(async (keys, cb) => cb()),
}));

describe("applyAssignmentMoves", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(store.withScheduleLock).mockImplementation(async (keys, cb) =>
      cb(),
    );
  });

  const baseConfig = {
    id: "CONFIG_1",
    type: "TYPE_A",
    isOperating: true,
    frozenDays: 1,
    productionDays: 3,
    bufferDays: 2,
    splittable: false,
    algorithm: "GREEDY_BEST_FIT",
    reschedulePolicy: "GAP_FILLING",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("should block a move that exceeds factory capacity", async () => {
    const move: AssignmentMove = {
      assignmentId: "A1",
      factoryId: "F1",
      productionDate: "2026-06-10",
    };

    vi.mocked(assignmentRepo.findAssignmentsByIds).mockResolvedValue([
      {
        id: "A1",
        orderId: "O1",
        factoryId: "F2",
        productionDate: new Date("2026-06-05T00:00:00.000Z"),
        completionDate: new Date("2026-06-08T00:00:00.000Z"),
        assignedQuantity: 1000,
        status: AssignmentStatus.SCHEDULED,
        order: {
          type: "TYPE_A",
          dueDate: new Date("2026-06-20T00:00:00.000Z"),
        },
      },
    ]);

    vi.mocked(
      autoSchedulerConfigRepo.getOperatingAutoSchedulerConfigs,
    ).mockResolvedValue([baseConfig]);

    vi.mocked(factoryRepo.findFactoriesMaxCapacity).mockResolvedValue([
      {
        id: "F1",
        maxCapacity: 1000,
      },
    ]);

    // Target date has 0 curCapacity because it was fully used
    vi.mocked(capacityRepo.findDailyCapacity).mockResolvedValue({
      id: "C1",
      factoryId: "F1",
      date: new Date("2026-06-10T00:00:00.000Z"),
      maxCapacity: 1000,
      curCapacity: 0,
    });

    await expect(
      applyAssignmentMoves(prisma, [move], "user-1"),
    ).rejects.toThrowError(ManualEditValidationError);

    try {
      await applyAssignmentMoves(prisma, [move], "user-1");
    } catch (error: unknown) {
      expect((error as ManualEditValidationError).violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetId: "A1",
            code: "CAPACITY_EXCEEDED",
          }),
        ]),
      );
    }
  });

  it("should block a move that violates the calculated deadline", async () => {
    // dueDate = 2026-06-10
    // config: bufferDays = 2, productionDays = 3
    // windowEnd = 2026-06-10 - 2 - (3 - 1) = 2026-06-06
    // Requested productionDate = 2026-06-07 -> Should violate

    const move: AssignmentMove = {
      orderId: "O2", // Testing PENDING -> SCHEDULED path
      factoryId: "F1",
      productionDate: "2026-06-07",
    };

    vi.mocked(orderRepo.findOrderById).mockResolvedValue({
      id: "O2",
      status: OrderStatus.PENDING,
      quantity: 500,
      dueDate: new Date("2026-06-10T00:00:00.000Z"),
      type: "TYPE_A",
    });

    vi.mocked(
      autoSchedulerConfigRepo.getOperatingAutoSchedulerConfigs,
    ).mockResolvedValue([baseConfig]);

    vi.mocked(factoryRepo.findFactoriesMaxCapacity).mockResolvedValue([
      {
        id: "F1",
        maxCapacity: 1000,
      },
    ]);

    // Capacity is sufficient
    vi.mocked(capacityRepo.findDailyCapacity).mockResolvedValue({
      id: "C1",
      factoryId: "F1",
      date: new Date("2026-06-07T00:00:00.000Z"),
      maxCapacity: 1000,
      curCapacity: 1000,
    });

    await expect(
      applyAssignmentMoves(prisma, [move], "user-1"),
    ).rejects.toThrowError(ManualEditValidationError);

    try {
      await applyAssignmentMoves(prisma, [move], "user-1");
    } catch (error: unknown) {
      expect((error as ManualEditValidationError).violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetId: "O2",
            code: "DEADLINE_VIOLATION",
          }),
        ]),
      );
    }
  });

  it("should successfully schedule a PENDING order", async () => {
    const move: AssignmentMove = {
      orderId: "O3",
      factoryId: "F1",
      productionDate: "2026-06-01",
    };

    vi.mocked(orderRepo.findOrderById).mockResolvedValue({
      id: "O3",
      status: OrderStatus.PENDING,
      quantity: 500,
      dueDate: new Date("2026-06-10T00:00:00.000Z"),
      type: "TYPE_A",
    });

    vi.mocked(
      autoSchedulerConfigRepo.getOperatingAutoSchedulerConfigs,
    ).mockResolvedValue([baseConfig]);

    vi.mocked(factoryRepo.findFactoriesMaxCapacity).mockResolvedValue([
      {
        id: "F1",
        maxCapacity: 1000,
      },
    ]);

    // Capacity is sufficient
    vi.mocked(capacityRepo.findDailyCapacity).mockResolvedValue({
      id: "C1",
      factoryId: "F1",
      date: new Date("2026-06-01T00:00:00.000Z"),
      maxCapacity: 1000,
      curCapacity: 1000,
    });

    const result = await applyAssignmentMoves(prisma, [move], "user-1");

    expect(result.applied).toBe(1);
    expect(capacityRepo.upsertDailyCapacityDelta).toHaveBeenCalledWith(
      mockTx,
      "F1",
      new Date("2026-06-01T00:00:00.000Z"),
      -500, // Reduced by assigned quantity
      1000,
    );
    expect(assignmentRepo.createAssignments).toHaveBeenCalled();
    expect(orderRepo.bulkUpdateOrderStatusAndModifiedBy).toHaveBeenCalledWith(
      mockTx,
      ["O3"],
      OrderStatus.SCHEDULED,
      "user-1",
    );
  });

  it("should successfully move an existing SCHEDULED assignment", async () => {
    const move: AssignmentMove = {
      assignmentId: "A2",
      factoryId: "F2",
      productionDate: "2026-06-02",
    };

    vi.mocked(assignmentRepo.findAssignmentsByIds).mockResolvedValue([
      {
        id: "A2",
        orderId: "O4",
        factoryId: "F1",
        productionDate: new Date("2026-06-01T00:00:00.000Z"),
        completionDate: new Date("2026-06-04T00:00:00.000Z"),
        assignedQuantity: 500,
        status: AssignmentStatus.SCHEDULED,
        order: {
          type: "TYPE_A",
          dueDate: new Date("2026-06-10T00:00:00.000Z"),
        },
      },
    ]);
    vi.mocked(
      autoSchedulerConfigRepo.getOperatingAutoSchedulerConfigs,
    ).mockResolvedValue([baseConfig]);
    vi.mocked(factoryRepo.findFactoriesMaxCapacity).mockResolvedValue([
      { id: "F1", maxCapacity: 1000 },
      { id: "F2", maxCapacity: 1000 },
    ]);
    // Target capacity is sufficient
    vi.mocked(capacityRepo.findDailyCapacity).mockResolvedValue({
      id: "C2",
      factoryId: "F2",
      date: new Date("2026-06-02T00:00:00.000Z"),
      maxCapacity: 1000,
      curCapacity: 1000,
    });

    const result = await applyAssignmentMoves(prisma, [move], "user-1");

    expect(result.applied).toBe(1);

    // Add capacity back to old date
    expect(capacityRepo.upsertDailyCapacityDelta).toHaveBeenCalledWith(
      mockTx,
      "F1",
      new Date("2026-06-01T00:00:00.000Z"),
      500,
      1000,
    );

    // Deduct capacity from new date
    expect(capacityRepo.upsertDailyCapacityDelta).toHaveBeenCalledWith(
      mockTx,
      "F2",
      new Date("2026-06-02T00:00:00.000Z"),
      -500,
      1000,
    );

    expect(assignmentRepo.updateAssignmentSlot).toHaveBeenCalled();
  });
});

// The following is necessary because we changed how dependencies are mocked in infra
