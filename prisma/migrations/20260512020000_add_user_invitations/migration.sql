ALTER TABLE "user"
ALTER COLUMN "accountId" DROP NOT NULL;

CREATE TABLE "user_invitation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_invitation_tokenHash_key" ON "user_invitation"("tokenHash");
CREATE INDEX "user_invitation_userId_idx" ON "user_invitation"("userId");
CREATE INDEX "user_invitation_createdById_idx" ON "user_invitation"("createdById");

ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_invitation" ADD CONSTRAINT "user_invitation_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
