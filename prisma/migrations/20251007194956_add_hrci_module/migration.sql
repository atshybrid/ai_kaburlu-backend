-- CreateEnum
CREATE TYPE "public"."CaseStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."PaymentPurpose" AS ENUM ('ID_CARD_ISSUE', 'ID_CARD_RENEW', 'DONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND');

-- CreateEnum
CREATE TYPE "public"."TeamScopeLevel" AS ENUM ('GLOBAL', 'COUNTRY', 'STATE', 'DISTRICT', 'MANDAL');

-- CreateEnum
CREATE TYPE "public"."IdCardStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "public"."HrcTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeLevel" "public"."TeamScopeLevel" NOT NULL,
    "countryCode" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "mandalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcVolunteerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "aadhaarNumber" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "pincode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcVolunteerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "role" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "HrcTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcIdCard" (
    "id" TEXT NOT NULL,
    "volunteerId" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "renewalIntervalMonths" INTEGER NOT NULL,
    "feeAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "public"."IdCardStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentTxnId" TEXT,
    "revokedReason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcIdCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcCase" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "public"."CasePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "public"."CaseStatus" NOT NULL DEFAULT 'NEW',
    "reporterId" TEXT,
    "teamId" TEXT,
    "assignedToId" TEXT,
    "locationStateId" TEXT,
    "locationDistrictId" TEXT,
    "locationMandalId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcCaseUpdate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT,
    "statusFrom" "public"."CaseStatus",
    "statusTo" "public"."CaseStatus",
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrcCaseUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcCaseAttachment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "uploadedById" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrcCaseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HrcDonation" (
    "id" TEXT NOT NULL,
    "donorUserId" TEXT,
    "donorName" TEXT,
    "donorEmail" TEXT,
    "donorPhone" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "purpose" TEXT,
    "paymentTxnId" TEXT,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "refundedMinor" INTEGER,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcDonation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentFeeConfig" (
    "id" TEXT NOT NULL,
    "purpose" "public"."PaymentPurpose" NOT NULL,
    "scopeLevel" "public"."TeamScopeLevel",
    "teamId" TEXT,
    "stateId" TEXT,
    "districtId" TEXT,
    "mandalId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "renewalIntervalMonths" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentFeeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentTransaction" (
    "id" TEXT NOT NULL,
    "purpose" "public"."PaymentPurpose" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "providerSignature" TEXT,
    "refundIds" TEXT[],
    "meta" JSONB,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "signature" TEXT,
    "relatedOrderId" TEXT,
    "relatedPaymentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrcTeam_scopeLevel_idx" ON "public"."HrcTeam"("scopeLevel");

-- CreateIndex
CREATE INDEX "HrcTeam_stateId_idx" ON "public"."HrcTeam"("stateId");

-- CreateIndex
CREATE INDEX "HrcTeam_districtId_idx" ON "public"."HrcTeam"("districtId");

-- CreateIndex
CREATE INDEX "HrcTeam_mandalId_idx" ON "public"."HrcTeam"("mandalId");

-- CreateIndex
CREATE UNIQUE INDEX "HrcVolunteerProfile_userId_key" ON "public"."HrcVolunteerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HrcVolunteerProfile_aadhaarNumber_key" ON "public"."HrcVolunteerProfile"("aadhaarNumber");

-- CreateIndex
CREATE INDEX "HrcTeamMember_volunteerId_idx" ON "public"."HrcTeamMember"("volunteerId");

-- CreateIndex
CREATE UNIQUE INDEX "HrcTeamMember_teamId_volunteerId_key" ON "public"."HrcTeamMember"("teamId", "volunteerId");

-- CreateIndex
CREATE INDEX "HrcIdCard_volunteerId_idx" ON "public"."HrcIdCard"("volunteerId");

-- CreateIndex
CREATE INDEX "HrcIdCard_status_idx" ON "public"."HrcIdCard"("status");

-- CreateIndex
CREATE UNIQUE INDEX "HrcCase_referenceCode_key" ON "public"."HrcCase"("referenceCode");

-- CreateIndex
CREATE INDEX "HrcCase_status_idx" ON "public"."HrcCase"("status");

-- CreateIndex
CREATE INDEX "HrcCase_teamId_idx" ON "public"."HrcCase"("teamId");

-- CreateIndex
CREATE INDEX "HrcCase_assignedToId_idx" ON "public"."HrcCase"("assignedToId");

-- CreateIndex
CREATE INDEX "HrcCase_priority_idx" ON "public"."HrcCase"("priority");

-- CreateIndex
CREATE INDEX "HrcCaseUpdate_caseId_idx" ON "public"."HrcCaseUpdate"("caseId");

-- CreateIndex
CREATE INDEX "HrcCaseAttachment_caseId_idx" ON "public"."HrcCaseAttachment"("caseId");

-- CreateIndex
CREATE INDEX "HrcDonation_donorUserId_idx" ON "public"."HrcDonation"("donorUserId");

-- CreateIndex
CREATE INDEX "HrcDonation_status_idx" ON "public"."HrcDonation"("status");

-- CreateIndex
CREATE INDEX "PaymentFeeConfig_purpose_active_idx" ON "public"."PaymentFeeConfig"("purpose", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_providerOrderId_key" ON "public"."PaymentTransaction"("providerOrderId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_purpose_idx" ON "public"."PaymentTransaction"("purpose");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "public"."PaymentTransaction"("status");

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_processed_idx" ON "public"."RazorpayWebhookEvent"("processed");

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_relatedOrderId_idx" ON "public"."RazorpayWebhookEvent"("relatedOrderId");

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_relatedPaymentId_idx" ON "public"."RazorpayWebhookEvent"("relatedPaymentId");

-- AddForeignKey
ALTER TABLE "public"."HrcTeam" ADD CONSTRAINT "HrcTeam_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "public"."State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcTeam" ADD CONSTRAINT "HrcTeam_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "public"."District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcTeam" ADD CONSTRAINT "HrcTeam_mandalId_fkey" FOREIGN KEY ("mandalId") REFERENCES "public"."Mandal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcVolunteerProfile" ADD CONSTRAINT "HrcVolunteerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcTeamMember" ADD CONSTRAINT "HrcTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."HrcTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcTeamMember" ADD CONSTRAINT "HrcTeamMember_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcIdCard" ADD CONSTRAINT "HrcIdCard_volunteerId_fkey" FOREIGN KEY ("volunteerId") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcIdCard" ADD CONSTRAINT "HrcIdCard_paymentTxnId_fkey" FOREIGN KEY ("paymentTxnId") REFERENCES "public"."PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."HrcTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_locationStateId_fkey" FOREIGN KEY ("locationStateId") REFERENCES "public"."State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_locationDistrictId_fkey" FOREIGN KEY ("locationDistrictId") REFERENCES "public"."District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCase" ADD CONSTRAINT "HrcCase_locationMandalId_fkey" FOREIGN KEY ("locationMandalId") REFERENCES "public"."Mandal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseUpdate" ADD CONSTRAINT "HrcCaseUpdate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."HrcCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseUpdate" ADD CONSTRAINT "HrcCaseUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseAttachment" ADD CONSTRAINT "HrcCaseAttachment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."HrcCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcCaseAttachment" ADD CONSTRAINT "HrcCaseAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "public"."HrcVolunteerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcDonation" ADD CONSTRAINT "HrcDonation_paymentTxnId_fkey" FOREIGN KEY ("paymentTxnId") REFERENCES "public"."PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentFeeConfig" ADD CONSTRAINT "PaymentFeeConfig_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."HrcTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentFeeConfig" ADD CONSTRAINT "PaymentFeeConfig_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "public"."State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentFeeConfig" ADD CONSTRAINT "PaymentFeeConfig_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "public"."District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentFeeConfig" ADD CONSTRAINT "PaymentFeeConfig_mandalId_fkey" FOREIGN KEY ("mandalId") REFERENCES "public"."Mandal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
