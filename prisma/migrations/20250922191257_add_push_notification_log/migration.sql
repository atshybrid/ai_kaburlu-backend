-- DropForeignKey
ALTER TABLE "public"."Comment" DROP CONSTRAINT "Comment_articleId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Comment" DROP CONSTRAINT "Comment_shortNews_fkey";

-- AlterTable
ALTER TABLE "public"."ContentReaction" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."PushNotificationLog" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "data" JSONB,
    "deliveryType" TEXT NOT NULL,
    "targetTokens" TEXT[],
    "targetUserId" TEXT,
    "targetTopic" TEXT,
    "batchId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalTargets" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "fcmMessageId" TEXT,
    "fcmResponse" JSONB,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "environment" TEXT,
    "sourceController" TEXT,
    "sourceAction" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushNotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushNotificationLog_status_idx" ON "public"."PushNotificationLog"("status");

-- CreateIndex
CREATE INDEX "PushNotificationLog_deliveryType_idx" ON "public"."PushNotificationLog"("deliveryType");

-- CreateIndex
CREATE INDEX "PushNotificationLog_targetUserId_idx" ON "public"."PushNotificationLog"("targetUserId");

-- CreateIndex
CREATE INDEX "PushNotificationLog_targetTopic_idx" ON "public"."PushNotificationLog"("targetTopic");

-- CreateIndex
CREATE INDEX "PushNotificationLog_batchId_idx" ON "public"."PushNotificationLog"("batchId");

-- CreateIndex
CREATE INDEX "PushNotificationLog_createdAt_idx" ON "public"."PushNotificationLog"("createdAt");

-- CreateIndex
CREATE INDEX "PushNotificationLog_nextRetryAt_idx" ON "public"."PushNotificationLog"("nextRetryAt");

-- RenameForeignKey
ALTER TABLE "public"."ContentReaction" RENAME CONSTRAINT "ContentReaction_user_fkey" TO "ContentReaction_userId_fkey";

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "public"."Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comment" ADD CONSTRAINT "Comment_shortNewsId_fkey" FOREIGN KEY ("shortNewsId") REFERENCES "public"."ShortNews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PushNotificationLog" ADD CONSTRAINT "PushNotificationLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "public"."ContentReaction_content_idx" RENAME TO "ContentReaction_contentType_contentId_idx";

-- RenameIndex
ALTER INDEX "public"."ContentReaction_user_content_unique" RENAME TO "ContentReaction_userId_contentType_contentId_key";

-- RenameIndex
ALTER INDEX "public"."ContentReaction_user_idx" RENAME TO "ContentReaction_userId_idx";
