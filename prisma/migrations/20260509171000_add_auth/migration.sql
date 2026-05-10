-- Add auth account fields. Existing seed/dev users are backfilled with id as accountId.
ALTER TABLE "user"
ADD COLUMN "accountId" TEXT,
ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3);

UPDATE "user"
SET "accountId" = "id"
WHERE "accountId" IS NULL;

ALTER TABLE "user"
ALTER COLUMN "accountId" SET NOT NULL;

CREATE UNIQUE INDEX "user_accountId_key" ON "user"("accountId");

-- DB-backed refresh tokens. tokenHash stores a SHA-256 hash, never the bearer token itself.
CREATE TABLE "refresh_token" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedByTokenId" TEXT,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_token_tokenHash_key" ON "refresh_token"("tokenHash");
CREATE UNIQUE INDEX "refresh_token_replacedByTokenId_key" ON "refresh_token"("replacedByTokenId");
CREATE INDEX "refresh_token_userId_idx" ON "refresh_token"("userId");

ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_replacedByTokenId_fkey"
FOREIGN KEY ("replacedByTokenId") REFERENCES "refresh_token"("id") ON DELETE SET NULL ON UPDATE CASCADE;
