-- Existing plaintext email-change tokens cannot be safely migrated because the
-- raw token value may already have been sent. Invalidate pending requests and
-- require users to request a fresh verification link.
DELETE FROM "email_change_token";

ALTER TABLE "email_change_token" DROP COLUMN "token";
ALTER TABLE "email_change_token" ADD COLUMN "tokenHash" TEXT NOT NULL;

CREATE UNIQUE INDEX "email_change_token_tokenHash_key" ON "email_change_token"("tokenHash");
