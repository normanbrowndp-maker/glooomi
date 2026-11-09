ALTER TABLE "Session"
  ADD COLUMN "previousRefreshTokenHash" TEXT,
  ADD COLUMN "refreshTokenCiphertext" TEXT,
  ADD COLUMN "refreshTokenIv" TEXT,
  ADD COLUMN "refreshTokenTag" TEXT,
  ADD COLUMN "rotatedAt" TIMESTAMP(3);

CREATE TYPE "EmailOutboxKind" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "EmailOutboxKind" NOT NULL,
  "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "jobId" TEXT NOT NULL,
  "payloadCiphertext" TEXT NOT NULL,
  "payloadIv" TEXT NOT NULL,
  "payloadTag" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EmailOutbox_jobId_key" ON "EmailOutbox"("jobId");
CREATE INDEX "EmailOutbox_status_availableAt_createdAt_idx" ON "EmailOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "EmailOutbox_status_lockedAt_idx" ON "EmailOutbox"("status", "lockedAt");
CREATE INDEX "EmailOutbox_userId_kind_createdAt_idx" ON "EmailOutbox"("userId", "kind", "createdAt" DESC);
