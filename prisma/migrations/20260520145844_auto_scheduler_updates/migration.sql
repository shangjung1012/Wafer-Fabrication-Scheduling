/*
  Warnings:

  - Added the required column `completionDate` to the `order_assignment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SYSTEM';

-- AlterTable
ALTER TABLE "order_assignment" ADD COLUMN     "completionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "order_assignment" ALTER COLUMN "completionDate" DROP DEFAULT;

-- CreateTable
CREATE TABLE "auto_scheduler_config" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isOperating" BOOLEAN NOT NULL DEFAULT true,
    "frozenDays" INTEGER NOT NULL DEFAULT 0,
    "productionDays" INTEGER NOT NULL DEFAULT 1,
    "bufferDays" INTEGER NOT NULL DEFAULT 0,
    "reschedulePolicy" TEXT NOT NULL DEFAULT 'GAP_FILLING',
    "algorithm" TEXT NOT NULL DEFAULT 'GREEDY_BEST_FIT',
    "splittable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "auto_scheduler_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_scheduler_config_type_key" ON "auto_scheduler_config"("type");
