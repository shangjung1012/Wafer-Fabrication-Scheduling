/*
  Warnings:

  - You are about to drop the `order_permission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "order_permission" DROP CONSTRAINT "order_permission_orderId_fkey";

-- DropForeignKey
ALTER TABLE "order_permission" DROP CONSTRAINT "order_permission_userId_fkey";

-- DropTable
DROP TABLE "order_permission";
