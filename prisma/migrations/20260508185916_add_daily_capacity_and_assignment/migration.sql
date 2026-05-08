/*
  Warnings:

  - You are about to drop the column `curCapacity` on the `factory` table. All the data in the column will be lost.

*/
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'APPROVED';

-- DropForeignKey
ALTER TABLE "order" DROP CONSTRAINT "order_factoryId_fkey";

-- AlterTable
ALTER TABLE "factory" DROP COLUMN "curCapacity",
ALTER COLUMN "maxCapacity" SET DEFAULT 10000;

-- CreateTable
CREATE TABLE "daily_capacity" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "curAmount" INTEGER NOT NULL,

    CONSTRAINT "daily_capacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "assignedQuantity" INTEGER NOT NULL,

    CONSTRAINT "order_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_capacity_factoryId_date_key" ON "daily_capacity"("factoryId", "date");

-- AddForeignKey
ALTER TABLE "daily_capacity" ADD CONSTRAINT "daily_capacity_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignment" ADD CONSTRAINT "order_assignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignment" ADD CONSTRAINT "order_assignment_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
