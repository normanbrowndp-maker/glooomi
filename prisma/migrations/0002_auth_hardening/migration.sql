ALTER TABLE "VerificationCode"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "invalidatedAt" TIMESTAMP(3);
