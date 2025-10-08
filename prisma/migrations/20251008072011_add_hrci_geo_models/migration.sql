/*
  Warnings:

  - You are about to drop the `HrcCase` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcCaseAttachment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcCaseUpdate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcCellCatalog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcDonation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcIdCard` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcIdCardPlan` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcTeam` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcTeamMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `HrcVolunteerProfile` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentFeeConfig` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PaymentTransaction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RazorpayWebhookEvent` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."HrcZone" AS ENUM ('NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL');

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_locationDistrictId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_locationMandalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_locationStateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_reporterId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCase" DROP CONSTRAINT "HrcCase_teamId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCaseAttachment" DROP CONSTRAINT "HrcCaseAttachment_caseId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCaseAttachment" DROP CONSTRAINT "HrcCaseAttachment_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCaseUpdate" DROP CONSTRAINT "HrcCaseUpdate_authorId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcCaseUpdate" DROP CONSTRAINT "HrcCaseUpdate_caseId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcDonation" DROP CONSTRAINT "HrcDonation_paymentTxnId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcIdCard" DROP CONSTRAINT "HrcIdCard_paymentTxnId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcIdCard" DROP CONSTRAINT "HrcIdCard_planId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcIdCard" DROP CONSTRAINT "HrcIdCard_volunteerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcTeam" DROP CONSTRAINT "HrcTeam_cellCatalogId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcTeam" DROP CONSTRAINT "HrcTeam_districtId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcTeam" DROP CONSTRAINT "HrcTeam_mandalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcTeam" DROP CONSTRAINT "HrcTeam_stateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcTeamMember" DROP CONSTRAINT "HrcTeamMember_teamId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcTeamMember" DROP CONSTRAINT "HrcTeamMember_volunteerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."HrcVolunteerProfile" DROP CONSTRAINT "HrcVolunteerProfile_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PaymentFeeConfig" DROP CONSTRAINT "PaymentFeeConfig_districtId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PaymentFeeConfig" DROP CONSTRAINT "PaymentFeeConfig_mandalId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PaymentFeeConfig" DROP CONSTRAINT "PaymentFeeConfig_stateId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PaymentFeeConfig" DROP CONSTRAINT "PaymentFeeConfig_teamId_fkey";

-- DropTable
DROP TABLE "public"."HrcCase";

-- DropTable
DROP TABLE "public"."HrcCaseAttachment";

-- DropTable
DROP TABLE "public"."HrcCaseUpdate";

-- DropTable
DROP TABLE "public"."HrcCellCatalog";

-- DropTable
DROP TABLE "public"."HrcDonation";

-- DropTable
DROP TABLE "public"."HrcIdCard";

-- DropTable
DROP TABLE "public"."HrcIdCardPlan";

-- DropTable
DROP TABLE "public"."HrcTeam";

-- DropTable
DROP TABLE "public"."HrcTeamMember";

-- DropTable
DROP TABLE "public"."HrcVolunteerProfile";

-- DropTable
DROP TABLE "public"."PaymentFeeConfig";

-- DropTable
DROP TABLE "public"."PaymentTransaction";

-- DropTable
DROP TABLE "public"."RazorpayWebhookEvent";

-- DropEnum
DROP TYPE "public"."CasePriority";

-- DropEnum
DROP TYPE "public"."CaseStatus";

-- DropEnum
DROP TYPE "public"."HrcCellType";

-- DropEnum
DROP TYPE "public"."HrcTeamMemberRole";

-- DropEnum
DROP TYPE "public"."IdCardStatus";

-- DropEnum
DROP TYPE "public"."PaymentPurpose";

-- DropEnum
DROP TYPE "public"."PaymentStatus";

-- DropEnum
DROP TYPE "public"."TeamScopeLevel";

-- CreateTable
CREATE TABLE "public"."HrcCountry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcCountry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcState" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "zone" "public"."HrcZone" NOT NULL,
    "countryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcDistrict" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcDistrict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcMandal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcMandal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrcCountry_name_key" ON "public"."HrcCountry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "HrcCountry_code_key" ON "public"."HrcCountry"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HrcState_name_key" ON "public"."HrcState"("name");

-- CreateIndex
CREATE UNIQUE INDEX "HrcState_code_key" ON "public"."HrcState"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HrcDistrict_stateId_name_key" ON "public"."HrcDistrict"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "HrcMandal_districtId_name_key" ON "public"."HrcMandal"("districtId", "name");

-- AddForeignKey
ALTER TABLE "public"."HrcState" ADD CONSTRAINT "HrcState_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "public"."HrcCountry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcDistrict" ADD CONSTRAINT "HrcDistrict_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "public"."HrcState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcMandal" ADD CONSTRAINT "HrcMandal_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "public"."HrcDistrict"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
