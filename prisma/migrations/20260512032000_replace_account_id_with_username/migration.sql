ALTER TABLE "user" RENAME COLUMN "accountId" TO "username";

ALTER INDEX IF EXISTS "user_accountId_key" RENAME TO "user_username_key";

ALTER TABLE "user" DROP COLUMN "name";
