import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/system/simulation/route";
import {
  CsrfError,
  UnauthorizedError,
} from "@/modules/auth/require-auth";

const {
  prisma,
  requireAuth,
  getSystemState,
  upsertSystemState,
  handleSimulationTimeAdvance,
} = vi.hoisted(() => ({
  prisma: {},
  requireAuth: vi.fn(),
  getSystemState: vi.fn(),
  upsertSystemState: vi.fn(),
  handleSimulationTimeAdvance: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/modules/auth/require-auth", () => ({
  requireAuth,
  UnauthorizedError: class MockUnauthorizedError extends Error {
    readonly status = 401 as const;
    readonly code = "UNAUTHORIZED" as const;
    constructor(message = "Missing or invalid token") {
      super(message);
      this.name = "UnauthorizedError";
    }
  },
  CsrfError: class MockCsrfError extends Error {
    readonly status = 403 as const;
    readonly code = "CSRF_FORBIDDEN" as const;
    constructor(message = "Request origin is not allowed.") {
      super(message);
      this.name = "CsrfError";
    }
  },
}));
vi.mock("@/infra/db/system-state-repository", () => ({
  getSystemState,
  upsertSystemState,
}));
vi.mock("@/modules/schedule/simulation-service", () => ({
  handleSimulationTimeAdvance,
}));

describe("/api/system/simulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({
      requestId: "r1",
      user: { id: "admin-1", role: "ADMIN", username: "admin" },
    });
    getSystemState.mockResolvedValue({
      id: "global",
      isSimulationMode: false,
      simulationDate: null,
    });
  });

  describe("GET", () => {
    it("returns simulation state when authenticated", async () => {
      const state = {
        id: "global",
        isSimulationMode: true,
        simulationDate: new Date("2026-01-15T00:00:00.000Z"),
      };
      getSystemState.mockResolvedValueOnce(state);

      const res = await GET(
        new Request("http://localhost/api/system/simulation"),
      );
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        ...state,
        simulationDate: state.simulationDate.toISOString(),
      });
      expect(getSystemState).toHaveBeenCalledWith(prisma);
    });

    it("returns 401 when requireAuth fails", async () => {
      requireAuth.mockRejectedValueOnce(new UnauthorizedError());
      const res = await GET(
        new Request("http://localhost/api/system/simulation"),
      );
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expect(getSystemState).not.toHaveBeenCalled();
    });

    it("returns 403 for CSRF-style auth errors", async () => {
      requireAuth.mockRejectedValueOnce(new CsrfError());
      const res = await GET(
        new Request("http://localhost/api/system/simulation"),
      );
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        code: "CSRF_FORBIDDEN",
      });
    });
  });

  describe("PATCH", () => {
    function patchRequest(body: unknown): Request {
      return new Request("http://localhost/api/system/simulation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    it("returns 401 when unauthenticated", async () => {
      requireAuth.mockRejectedValueOnce(new UnauthorizedError());
      const res = await PATCH(patchRequest({ isSimulationMode: true }));
      expect(res.status).toBe(401);
      expect(getSystemState).not.toHaveBeenCalled();
    });

    it("returns 400 when body fails Zod validation", async () => {
      const res = await PATCH(patchRequest({ simulationDate: "not-iso" }));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        code: "BAD_REQUEST",
        message: "Invalid input",
      });
      expect(handleSimulationTimeAdvance).not.toHaveBeenCalled();
      expect(upsertSystemState).not.toHaveBeenCalled();
    });

    it("calls handleSimulationTimeAdvance when simulationDate is set", async () => {
      const oldDate = new Date("2026-01-01T00:00:00.000Z");
      const newIso = "2026-02-01T00:00:00.000Z";
      getSystemState
        .mockResolvedValueOnce({
          id: "global",
          isSimulationMode: true,
          simulationDate: oldDate,
        })
        .mockResolvedValueOnce({
          id: "global",
          isSimulationMode: true,
          simulationDate: new Date(newIso),
        });

      const res = await PATCH(patchRequest({ simulationDate: newIso }));
      expect(res.status).toBe(200);
      expect(handleSimulationTimeAdvance).toHaveBeenCalledTimes(1);
      const [oldArg, newArg, patchArg] =
        handleSimulationTimeAdvance.mock.calls[0];
      expect(oldArg?.getTime()).toBe(oldDate.getTime());
      expect(newArg?.toISOString()).toBe(new Date(newIso).toISOString());
      expect(patchArg).toMatchObject({
        simulationDate: new Date(newIso),
      });
      expect(upsertSystemState).not.toHaveBeenCalled();
      expect(getSystemState).toHaveBeenCalledTimes(2);
    });

    it("uses upsertSystemState when only flags change (no simulationDate patch)", async () => {
      getSystemState.mockResolvedValueOnce({
        id: "global",
        isSimulationMode: true,
        simulationDate: new Date("2026-03-01T00:00:00.000Z"),
      });
      getSystemState.mockResolvedValueOnce({
        id: "global",
        isSimulationMode: false,
        simulationDate: new Date("2026-03-01T00:00:00.000Z"),
      });

      const res = await PATCH(patchRequest({ isSimulationMode: false }));
      expect(res.status).toBe(200);
      expect(handleSimulationTimeAdvance).not.toHaveBeenCalled();
      expect(upsertSystemState).toHaveBeenCalledWith(prisma, {
        isSimulationMode: false,
      });
      expect(getSystemState).toHaveBeenCalledTimes(2);
    });

    it("treats empty object as no-op before returning fresh state", async () => {
      const finalState = {
        id: "global",
        isSimulationMode: false,
        simulationDate: null,
      };
      getSystemState
        .mockResolvedValueOnce({ ...finalState })
        .mockResolvedValueOnce({ ...finalState });

      const res = await PATCH(patchRequest({}));
      expect(res.status).toBe(200);
      expect(handleSimulationTimeAdvance).not.toHaveBeenCalled();
      expect(upsertSystemState).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toEqual(finalState);
    });

    it("accepts invalid JSON body as empty object (Zod passes)", async () => {
      const finalState = {
        id: "global",
        isSimulationMode: true,
        simulationDate: new Date("2026-04-01T00:00:00.000Z"),
      };
      getSystemState
        .mockResolvedValueOnce({ ...finalState })
        .mockResolvedValueOnce({ ...finalState });

      const res = await PATCH(
        new Request("http://localhost/api/system/simulation", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "not-json",
        }),
      );
      expect(res.status).toBe(200);
      expect(upsertSystemState).not.toHaveBeenCalled();
      expect(handleSimulationTimeAdvance).not.toHaveBeenCalled();
    });
  });
});
