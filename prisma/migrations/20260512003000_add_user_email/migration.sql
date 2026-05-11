ALTER TABLE "user"
ADD COLUMN "email" TEXT;

CREATE UNIQUE INDEX "user_email_key" ON "user"("email");
