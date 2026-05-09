/*
  Warnings:

  - You are about to drop the column `curAmount` on the `daily_capacity` table. All the data in the column will be lost.
  - You are about to drop the column `maxAmount` on the `daily_capacity` table. All the data in the column will be lost.
  - You are about to drop the column `factoryId` on the `order` table. All the data in the column will be lost.
  - You are about to drop the column `productionDate` on the `order` table. All the data in the column will be lost.
  - Added the required column `curCapacity` to the `daily_capacity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maxCapacity` to the `daily_capacity` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('SCHEDULED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "daily_capacity" DROP COLUMN "curAmount",
DROP COLUMN "maxAmount",
ADD COLUMN     "curCapacity" INTEGER NOT NULL,
ADD COLUMN     "maxCapacity" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "order" DROP COLUMN "factoryId",
DROP COLUMN "productionDate";

-- AlterTable
ALTER TABLE "order_assignment" ADD COLUMN     "status" "AssignmentStatus" NOT NULL DEFAULT 'SCHEDULED';
