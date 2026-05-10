/*
  Warnings:

  - You are about to drop the column `adminId` on the `factory` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "factory" DROP CONSTRAINT "factory_adminId_fkey";

-- AlterTable
ALTER TABLE "factory" DROP COLUMN "adminId";

-- CreateTable
CREATE TABLE "_FactoryAdmins" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_FactoryAdmins_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_FactoryAdmins_B_index" ON "_FactoryAdmins"("B");

-- AddForeignKey
ALTER TABLE "_FactoryAdmins" ADD CONSTRAINT "_FactoryAdmins_A_fkey" FOREIGN KEY ("A") REFERENCES "factory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_FactoryAdmins" ADD CONSTRAINT "_FactoryAdmins_B_fkey" FOREIGN KEY ("B") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
