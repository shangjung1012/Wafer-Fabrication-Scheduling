import { describe, expect, it, vi } from "vitest";

import {
  getSystemState,
  upsertSystemState,
} from "@/infra/db/system-state-repository";
import type { PrismaClient } from "@/lib/generated/prisma";

function makeDb(findUniqueResult: unknown = null) {
  return {
    systemState: {
      findUnique: vi.fn().mockResolvedValue(findUniqueResult),
      upsert: vi.fn().mockResolvedValue({ id: "global" }),
    },
  } as unknown as PrismaClient;
}

describe("system-state-repository", () => {
  it("returns persisted system state when it exists", async () => {
    const persisted = {
      id: "global",
      isSimulationMode: true,
      simulationDate: new Date("2026-06-03T00:00:00.000Z"),
    };
    const db = makeDb(persisted);

    await expect(getSystemState(db)).resolves.toBe(persisted);
    expect(db.systemState.findUnique).toHaveBeenCalledWith({
      where: { id: "global" },
    });
  });

  it("returns a default realtime state when no singleton row exists", async () => {
    const db = makeDb(null);

    await expect(getSystemState(db)).resolves.toEqual({
      id: "global",
      isSimulationMode: false,
      simulationDate: null,
    });
  });

  it("upserts the singleton system state row", async () => {
    const db = makeDb();
    const patch = {
      isSimulationMode: true,
      simulationDate: new Date("2026-06-04T00:00:00.000Z"),
    };

    await upsertSystemState(db, patch);

    expect(db.systemState.upsert).toHaveBeenCalledWith({
      where: { id: "global" },
      create: { id: "global", ...patch },
      update: patch,
    });
  });
});
