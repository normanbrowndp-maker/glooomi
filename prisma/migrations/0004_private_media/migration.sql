CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'ATTACHED', 'FAILED', 'DELETED');
CREATE TYPE "MediaPurpose" AS ENUM ('POST', 'STORY', 'AVATAR');

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "uploadUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Profile" ADD COLUMN "avatarMediaId" TEXT;
ALTER TABLE "Post" ADD COLUMN "mediaAssetId" TEXT;
ALTER TABLE "Story" ADD COLUMN "mediaAssetId" TEXT;

CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");
CREATE INDEX "MediaAsset_ownerId_status_createdAt_idx" ON "MediaAsset"("ownerId", "status", "createdAt" DESC);
CREATE INDEX "MediaAsset_status_uploadUntil_idx" ON "MediaAsset"("status", "uploadUntil");
CREATE UNIQUE INDEX "Profile_avatarMediaId_key" ON "Profile"("avatarMediaId");
CREATE UNIQUE INDEX "Post_mediaAssetId_key" ON "Post"("mediaAssetId");
CREATE UNIQUE INDEX "Story_mediaAssetId_key" ON "Story"("mediaAssetId");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
