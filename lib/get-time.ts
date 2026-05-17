import { prisma } from "@/lib/prisma";

export async function getTime(): Promise<Date> {
  const state = await prisma.systemState.findUnique({
    where: { id: "global" },
  });
  if (state?.isSimulationMode && state.simulationDate) {
    return new Date(state.simulationDate);
  }
  return new Date();
}
