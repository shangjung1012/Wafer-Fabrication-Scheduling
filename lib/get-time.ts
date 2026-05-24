import { prisma } from "@/lib/prisma";

export async function getTime(): Promise<Date> {
  const state = await prisma.systemState.findUnique({
    where: { id: "global" },
  });

  // Simulation Mode: Strict UTC midnight
  if (state?.isSimulationMode && state.simulationDate) {
    const d = new Date(state.simulationDate);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  // Real-time Mode: Calculate current business date via Env Var
  // Default to 0 (UTC) if BUSINESS_TIMEZONE_OFFSET is not set
  const businessOffsetHours = Number(process.env.BUSINESS_TIMEZONE_OFFSET) || 0;
  const nowUtc = new Date();
  const offsetMs = businessOffsetHours * 60 * 60 * 1000;
  const businessTime = new Date(nowUtc.getTime() + offsetMs);

  // Return strict UTC midnight representing the local business date
  return new Date(
    Date.UTC(
      businessTime.getUTCFullYear(),
      businessTime.getUTCMonth(),
      businessTime.getUTCDate(),
    ),
  );
}
