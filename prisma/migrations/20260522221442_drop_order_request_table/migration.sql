/*
  Warnings:

  - You are about to drop the `order_request` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "order_request" DROP CONSTRAINT IF EXISTS "order_request_applicantId_fkey";

-- DropForeignKey
ALTER TABLE "order_request" DROP CONSTRAINT IF EXISTS "order_request_orderId_fkey";

-- DropTable
DROP TABLE "order_request";
