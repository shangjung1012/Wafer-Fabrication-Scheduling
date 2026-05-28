import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  CsrfError,
  requireAuth,
  UnauthorizedError,
} from "@/modules/auth/require-auth";
import {
  getSystemState,
  upsertSystemState,
} from "@/infra/db/system-state-repository";
import {
  handleSimulationTimeAdvance,
  handleSimulationRevert,
} from "@/modules/schedule/simulation-service";

export async function GET(request: Request) {
  try {
    await requireAuth(request);
    const state = await getSystemState(prisma);
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof CsrfError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    console.error("Error fetching simulation state:", error);
    return NextResponse.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch simulation state",
      },
      { status: 500 },
    );
  }
}

const PatchSchema = z.object({
  isSimulationMode: z.boolean().optional(),
  simulationDate: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    await requireAuth(request);

    const body = await request.json().catch(() => ({}));
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "BAD_REQUEST",
          message: "Invalid input",
          details: parsed.error.format(),
        },
        { status: 400 },
      );
    }

    const { isSimulationMode, simulationDate } = parsed.data;
    const currentState = await getSystemState(prisma);

    const patch: { isSimulationMode?: boolean; simulationDate?: Date | null } =
      {};
    const nextIsSimulationMode =
      isSimulationMode ?? currentState.isSimulationMode;

    if (isSimulationMode !== undefined)
      patch.isSimulationMode = isSimulationMode;
    if (simulationDate !== undefined) {
      patch.simulationDate = simulationDate ? new Date(simulationDate) : null;
    }
    const nextSimulationDate =
      simulationDate !== undefined
        ? patch.simulationDate
        : currentState.simulationDate;
    if (nextIsSimulationMode && nextSimulationDate == null) {
      const now = new Date();
      patch.simulationDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
    }

    const switchingToRealTime =
      isSimulationMode === false && currentState.isSimulationMode === true;

    if (patch.simulationDate) {
      const newTime = new Date(patch.simulationDate);
      const oldTime = currentState.simulationDate
        ? new Date(currentState.simulationDate)
        : null;

      await handleSimulationTimeAdvance(oldTime, newTime, patch);
    } else if (switchingToRealTime) {
      await handleSimulationRevert(new Date(), patch);
    } else if (Object.keys(patch).length > 0) {
      await upsertSystemState(prisma, patch);
    }

    const state = await getSystemState(prisma);

    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json(
        { code: "UNAUTHORIZED", message: error.message },
        { status: 401 },
      );
    }
    if (error instanceof CsrfError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    console.error("Error updating simulation state:", error);
    return NextResponse.json(
      {
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update simulation state",
      },
      { status: 500 },
    );
  }
}
