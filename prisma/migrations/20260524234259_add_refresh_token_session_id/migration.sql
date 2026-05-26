-- AlterTable
ALTER TABLE "refresh_token" ADD COLUMN "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "refresh_token_sessionId_idx" ON "refresh_token"("sessionId");
