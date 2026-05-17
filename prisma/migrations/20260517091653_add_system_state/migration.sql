-- CreateTable
CREATE TABLE "system_state" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "isSimulationMode" BOOLEAN NOT NULL DEFAULT false,
    "simulationDate" TIMESTAMP(3),

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("id")
);
