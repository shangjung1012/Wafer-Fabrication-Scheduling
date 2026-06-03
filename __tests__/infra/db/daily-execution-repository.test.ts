import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    order: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  upsertSystemState: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/infra/db/system-state-repository", () => ({
  upsertSystemState: mocks.upsertSystemState,
}));

import {
  executeDailyStateAdvancement,
  getAffectedOrderTypes,
  revertSimulationStatuses,
} from "@/infra/db/daily-execution-repository";
import { AssignmentStatus, OrderStatus } from "@/lib/generated/prisma";

function makeTx() {
  return {
    orderAssignment: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    systemState: {
      upsert: vi.fn().mockResolvedValue({ id: "global" }),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback(makeTx()),
  );
});

describe("daily-execution-repository", () => {
  it("returns distinct affected order types for assignments crossing date boundaries", async () => {
    const currentDate = new Date("2026-06-03T00:00:00.000Z");
    mocks.prisma.order.findMany.mockResolvedValue([
      { type: "A" },
      { type: "B" },
    ]);

    const result = await getAffectedOrderTypes(currentDate);

    expect(result).toEqual(["A", "B"]);
    expect(mocks.prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        assignments: {
          some: {
            OR: [
              {
                status: AssignmentStatus.IN_PRODUCTION,
                completionDate: { lte: currentDate },
              },
              {
                status: AssignmentStatus.SCHEDULED,
                productionDate: { lte: currentDate },
              },
            ],
          },
        },
      },
      select: { type: true },
      distinct: ["type"],
    });
  });

  it("advances assignment and order statuses inside one transaction", async () => {
    const currentDate = new Date("2026-06-03T00:00:00.000Z");
    const patch = { isSimulationMode: true, simulationDate: currentDate };
    const tx = makeTx();
    tx.orderAssignment.findMany
      .mockResolvedValueOnce([
        { id: "a-complete", orderId: "o-complete" },
        { id: "a-start-same", orderId: "o-start" },
      ])
      .mockResolvedValueOnce([{ id: "a-start", orderId: "o-start" }]);
    tx.order.findMany.mockResolvedValue([
      {
        id: "o-complete",
        status: OrderStatus.IN_PRODUCTION,
        assignments: [{ status: AssignmentStatus.COMPLETED }],
      },
      {
        id: "o-start",
        status: OrderStatus.SCHEDULED,
        assignments: [
          { status: AssignmentStatus.IN_PRODUCTION },
          { status: AssignmentStatus.SCHEDULED },
        ],
      },
    ]);
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback(tx),
    );

    await executeDailyStateAdvancement(currentDate, patch);

    expect(mocks.upsertSystemState).toHaveBeenCalledWith(tx, patch);
    expect(tx.orderAssignment.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: {
          in: [AssignmentStatus.IN_PRODUCTION, AssignmentStatus.SCHEDULED],
        },
        completionDate: { lte: currentDate },
      },
      select: { id: true, orderId: true },
    });
    expect(tx.orderAssignment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: AssignmentStatus.SCHEDULED,
        productionDate: { lte: currentDate },
        completionDate: { gt: currentDate },
      },
      select: { id: true, orderId: true },
    });
    expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-complete", "a-start-same"] } },
      data: { status: AssignmentStatus.COMPLETED },
    });
    expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-start"] } },
      data: { status: AssignmentStatus.IN_PRODUCTION },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["o-complete"] } },
      data: { status: OrderStatus.COMPLETED },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["o-start"] } },
      data: { status: OrderStatus.IN_PRODUCTION },
    });
    expect(tx.systemState.upsert).toHaveBeenCalledWith({
      where: { id: "global" },
      create: { id: "global", ...patch },
      update: patch,
    });
  });

  it("returns early when daily advancement finds no affected assignments", async () => {
    const tx = makeTx();
    tx.orderAssignment.findMany.mockResolvedValue([]);
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback(tx),
    );

    await executeDailyStateAdvancement(new Date("2026-06-03T00:00:00.000Z"));

    expect(tx.order.findMany).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.systemState.upsert).not.toHaveBeenCalled();
  });

  it("reverts simulated assignments and recalculates parent order statuses", async () => {
    const realToday = new Date("2026-06-03T00:00:00.000Z");
    const patch = { isSimulationMode: false, simulationDate: null };
    const tx = makeTx();
    tx.orderAssignment.findMany
      .mockResolvedValueOnce([{ id: "a-future", orderId: "o-scheduled" }])
      .mockResolvedValueOnce([{ id: "a-current", orderId: "o-active" }]);
    tx.order.findMany.mockResolvedValue([
      {
        id: "o-complete",
        status: OrderStatus.IN_PRODUCTION,
        assignments: [{ status: AssignmentStatus.COMPLETED }],
      },
      {
        id: "o-active",
        status: OrderStatus.SCHEDULED,
        assignments: [
          { status: AssignmentStatus.IN_PRODUCTION },
          { status: AssignmentStatus.SCHEDULED },
        ],
      },
      {
        id: "o-scheduled",
        status: OrderStatus.IN_PRODUCTION,
        assignments: [{ status: AssignmentStatus.SCHEDULED }],
      },
    ]);
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback(tx),
    );

    await revertSimulationStatuses(realToday, patch);

    expect(mocks.upsertSystemState).toHaveBeenCalledWith(tx, patch);
    expect(tx.orderAssignment.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: {
          in: [AssignmentStatus.COMPLETED, AssignmentStatus.IN_PRODUCTION],
        },
        productionDate: { gt: realToday },
      },
      select: { id: true, orderId: true },
    });
    expect(tx.orderAssignment.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: AssignmentStatus.COMPLETED,
        productionDate: { lte: realToday },
        completionDate: { gt: realToday },
      },
      select: { id: true, orderId: true },
    });
    expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-future"] } },
      data: { status: AssignmentStatus.SCHEDULED },
    });
    expect(tx.orderAssignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-current"] } },
      data: { status: AssignmentStatus.IN_PRODUCTION },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["o-complete"] } },
      data: { status: OrderStatus.COMPLETED },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["o-active"] } },
      data: { status: OrderStatus.IN_PRODUCTION },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["o-scheduled"] } },
      data: { status: OrderStatus.SCHEDULED },
    });
  });

  it("returns early when simulation reversion finds no affected assignments", async () => {
    const tx = makeTx();
    tx.orderAssignment.findMany.mockResolvedValue([]);
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback(tx),
    );

    await revertSimulationStatuses(new Date("2026-06-03T00:00:00.000Z"));

    expect(tx.order.findMany).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });
});
