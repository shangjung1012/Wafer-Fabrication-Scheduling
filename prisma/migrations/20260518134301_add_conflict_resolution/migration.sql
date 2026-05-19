-- CreateEnum
CREATE TYPE "ConflictCommentType" AS ENUM ('COMMENT', 'PROPOSAL', 'RESOLUTION', 'REQUEUE');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'CONFLICT';

-- CreateTable
CREATE TABLE "conflict_comment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "ConflictCommentType" NOT NULL DEFAULT 'COMMENT',
    "proposalData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conflict_comment_orderId_idx" ON "conflict_comment"("orderId");

-- AddForeignKey
ALTER TABLE "conflict_comment" ADD CONSTRAINT "conflict_comment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_comment" ADD CONSTRAINT "conflict_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
