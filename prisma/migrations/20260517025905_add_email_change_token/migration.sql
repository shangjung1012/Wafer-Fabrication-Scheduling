-- CreateTable
CREATE TABLE "email_change_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_change_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_change_token_token_key" ON "email_change_token"("token");

-- CreateIndex
CREATE INDEX "email_change_token_userId_idx" ON "email_change_token"("userId");

-- AddForeignKey
ALTER TABLE "email_change_token" ADD CONSTRAINT "email_change_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
