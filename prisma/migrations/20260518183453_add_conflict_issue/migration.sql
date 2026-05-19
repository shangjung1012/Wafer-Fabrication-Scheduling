/*
  Warnings:

  - You are about to drop the `conflict_comment` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ConflictIssueStatus" AS ENUM ('OPEN', 'IN_DISCUSSION', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConflictResolution" AS ENUM ('REDUCED_QUANTITY', 'DELAYED_DUE_DATE', 'CANCELLED', 'WONT_FIX');

-- CreateEnum
CREATE TYPE "ConflictIssueEventType" AS ENUM ('OPENED', 'REASSIGNED', 'PROPOSAL_ACCEPTED', 'PROPOSAL_REJECTED', 'ORDER_UPDATED', 'REPREVIEW_RAN', 'RESOLVED', 'REOPENED', 'CLOSED');

-- DropForeignKey
ALTER TABLE "conflict_comment" DROP CONSTRAINT "conflict_comment_authorId_fkey";

-- DropForeignKey
ALTER TABLE "conflict_comment" DROP CONSTRAINT "conflict_comment_orderId_fkey";

-- DropTable
DROP TABLE "conflict_comment";

-- DropEnum
DROP TYPE "ConflictCommentType";

-- CreateTable
CREATE TABLE "conflict_issue" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ConflictIssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "ConflictResolution",
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contextSnapshot" JSONB NOT NULL,

    CONSTRAINT "conflict_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_issue_comment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "proposal" JSONB,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_issue_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_issue_event" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "ConflictIssueEventType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_issue_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conflict_issue_number_key" ON "conflict_issue"("number");

-- CreateIndex
CREATE INDEX "conflict_issue_orderId_idx" ON "conflict_issue"("orderId");

-- CreateIndex
CREATE INDEX "conflict_issue_status_idx" ON "conflict_issue"("status");

-- CreateIndex
CREATE INDEX "conflict_issue_comment_issueId_idx" ON "conflict_issue_comment"("issueId");

-- CreateIndex
CREATE INDEX "conflict_issue_event_issueId_idx" ON "conflict_issue_event"("issueId");

-- AddForeignKey
ALTER TABLE "conflict_issue" ADD CONSTRAINT "conflict_issue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_issue" ADD CONSTRAINT "conflict_issue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_issue" ADD CONSTRAINT "conflict_issue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_issue_comment" ADD CONSTRAINT "conflict_issue_comment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "conflict_issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_issue_comment" ADD CONSTRAINT "conflict_issue_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_issue_event" ADD CONSTRAINT "conflict_issue_event_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "conflict_issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_issue_event" ADD CONSTRAINT "conflict_issue_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
