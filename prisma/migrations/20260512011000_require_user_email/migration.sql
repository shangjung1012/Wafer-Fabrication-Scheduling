UPDATE "user"
SET "email" = lower(regexp_replace("accountId", '[^a-zA-Z0-9._+-]', '-', 'g')) || '@mail.shangjung.com'
WHERE "email" IS NULL;

ALTER TABLE "user"
ALTER COLUMN "email" SET NOT NULL;
