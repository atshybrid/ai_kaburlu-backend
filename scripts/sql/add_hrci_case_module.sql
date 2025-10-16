-- CreateEnum
CREATE TYPE "public"."CaseStatus" AS ENUM ('NEW', 'TRIAGED', 'IN_PROGRESS', 'LEGAL_REVIEW', 'ACTION_TAKEN', 'RESOLVED', 'REJECTED', 'CLOSED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "public"."CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."CaseVisibility" AS ENUM ('PRIVATE', 'PUBLIC_LINK');

-- CreateEnum
CREATE TYPE "public"."LegalStatus" AS ENUM ('NOT_REQUIRED', 'ADVISED', 'FILED', 'IN_COURT');

-- CreateTable
CREATE TABLE "public"."HrcCase" (
    "id" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "incidentAt" TIMESTAMP(3),
    "complainantUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "hrcCountryId" TEXT,
    "hrcStateId" TEXT,
    "hrcDistrictId" TEXT,
    "hrcMandalId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT,
    "category" TEXT,
    "priority" "public"."CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "public"."CaseStatus" NOT NULL DEFAULT 'NEW',
    "visibility" "public"."CaseVisibility" NOT NULL DEFAULT 'PRIVATE',
    "assignedToUserId" TEXT,
    "assignedRoleHint" TEXT,
    "legalSuggestion" TEXT,
    "legalStatus" "public"."LegalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "aiCategoryGuess" TEXT,
    "aiSeverityScore" DOUBLE PRECISION,
    "aiSummary" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcCaseComment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrcCaseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcCaseAttachment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "fileName" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrcCaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcCaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrcCaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrcCase_caseNumber_key" ON "public"."HrcCase"("caseNumber");

-- CreateIndex
CREATE INDEX "HrcCase_status_priority_createdAt_idx" ON "public"."HrcCase"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "HrcCase_hrcStateId_hrcDistrictId_hrcMandalId_status_idx" ON "public"."HrcCase"("hrcStateId", "hrcDistrictId", "hrcMandalId", "status");

-- AddForeignKey
ALTER TABLE "public"."HrcCaseComment" ADD CONSTRAINT "HrcCaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."HrcCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseAttachment" ADD CONSTRAINT "HrcCaseAttachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."HrcCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseAttachment" ADD CONSTRAINT "HrcCaseAttachment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "public"."Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseEvent" ADD CONSTRAINT "HrcCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."HrcCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

