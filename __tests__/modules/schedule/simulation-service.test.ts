import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleSimulationRevert,
  handleSimulationTimeAdvance,
} from "@/modules/schedule/simulation-service";
import { advanceOrderStatuses } from "@/modules/schedule/daily-execution";
import { triggerAutoSchedule } from "@/modules/schedule/auto-scheduler";
import { revertSimulationStatuses } from "@/infra/db/daily-execution-repository";
import { upsertSystemState } from "@/infra/db/system-state-repository";

vi.mock("@/modules/schedule/daily-execution", () => ({
  advanceOrderStatuses: vi.fn(),
}));

vi.mock("@/modules/schedule/auto-scheduler", () => ({
  triggerAutoSchedule: vi.fn(),
}));

vi.mock("@/infra/db/daily-execution-repository", () => ({
  revertSimulationStatuses: vi.fn(),
}));

vi.mock("@/infra/db/system-state-repository", () => ({
  upsertSystemState: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { marker: "prisma-client" },
}));

describe("simulation service", () => {
  const patch = {
    isSimulationMode: true,
    simulationDate: new Date("2026-06-03T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates simulation reverts to the repository", async () => {
    const realToday = new Date("2026-06-03T00:00:00.000Z");

    await handleSimulationRevert(realToday, patch);

    expect(revertSimulationStatuses).toHaveBeenCalledWith(realToday, patch);
  });

  it("only persists state when simulation time moves backward", async () => {
    await handleSimulationTimeAdvance(
      new Date("2026-06-03T10:00:00.000Z"),
      new Date("2026-06-03T09:00:00.000Z"),
      patch,
    );

    expect(upsertSystemState).toHaveBeenCalledWith(
      { marker: "prisma-client" },
      patch,
    );
    expect(advanceOrderStatuses).not.toHaveBeenCalled();
    expect(triggerAutoSchedule).not.toHaveBeenCalled();
  });

  it("advances order statuses after crossing midnight", async () => {
    const newTime = new Date("2026-06-04T00:15:00.000Z");

    await handleSimulationTimeAdvance(
      new Date("2026-06-03T23:00:00.000Z"),
      newTime,
      patch,
    );

    expect(advanceOrderStatuses).toHaveBeenCalledWith(newTime, patch);
    expect(triggerAutoSchedule).not.toHaveBeenCalled();
  });

  it("triggers auto scheduling after a same-day two hour jump", async () => {
    const newTime = new Date("2026-06-03T12:00:00.000Z");

    await handleSimulationTimeAdvance(
      new Date("2026-06-03T09:30:00.000Z"),
      newTime,
      patch,
    );

    expect(upsertSystemState).toHaveBeenCalledWith(
      { marker: "prisma-client" },
      patch,
    );
    expect(triggerAutoSchedule).toHaveBeenCalledWith(newTime);
  });
});
