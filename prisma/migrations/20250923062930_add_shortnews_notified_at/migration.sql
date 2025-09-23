-- AlterTable
ALTER TABLE "public"."ShortNews" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dislikeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notifiedAt" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "readCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ShortNews_status_publishedAt_idx" ON "public"."ShortNews"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "ShortNews_authorId_idx" ON "public"."ShortNews"("authorId");

-- CreateIndex
CREATE INDEX "ShortNews_categoryId_status_idx" ON "public"."ShortNews"("categoryId", "status");

-- CreateIndex
CREATE INDEX "ShortNews_language_idx" ON "public"."ShortNews"("language");

-- CreateIndex
CREATE INDEX "ShortNews_isPinned_priority_publishedAt_idx" ON "public"."ShortNews"("isPinned", "priority", "publishedAt");

-- AddForeignKey
ALTER TABLE "public"."ShortNews" ADD CONSTRAINT "ShortNews_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
