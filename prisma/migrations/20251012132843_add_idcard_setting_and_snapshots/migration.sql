-- AlterTable
ALTER TABLE "public"."IDCard" ADD COLUMN     "cellName" TEXT,
ADD COLUMN     "designationName" TEXT,
ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "mobileNumber" TEXT;

-- CreateTable
CREATE TABLE "public"."IdCardSetting" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "frontH1" TEXT,
    "frontH2" TEXT,
    "frontH3" TEXT,
    "frontH4" TEXT,
    "frontLogoUrl" TEXT,
    "secondLogoUrl" TEXT,
    "hrciStampUrl" TEXT,
    "authorSignUrl" TEXT,
    "registerDetails" TEXT,
    "frontFooterText" TEXT,
    "headOfficeAddress" TEXT,
    "terms" JSONB,
    "qrLandingBaseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdCardSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdCardSetting_isActive_idx" ON "public"."IdCardSetting"("isActive");
