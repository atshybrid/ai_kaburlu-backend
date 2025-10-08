-- CreateEnum
CREATE TYPE "public"."OrgLevel" AS ENUM ('NATIONAL', 'ZONE', 'STATE', 'DISTRICT', 'MANDAL');

-- CreateEnum
CREATE TYPE "public"."MembershipStatus" AS ENUM ('PENDING_PAYMENT', 'PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."IDCardStatus" AS ENUM ('NOT_CREATED', 'GENERATED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "public"."Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" VARCHAR(191),
    "defaultCapacity" INTEGER NOT NULL DEFAULT 0,
    "idCardFee" INTEGER NOT NULL DEFAULT 0,
    "validityDays" INTEGER NOT NULL DEFAULT 365,
    "orderRank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "designationId" TEXT NOT NULL,
    "level" "public"."OrgLevel" NOT NULL,
    "hrcCountryId" TEXT,
    "hrcStateId" TEXT,
    "hrcDistrictId" TEXT,
    "hrcMandalId" TEXT,
    "status" "public"."MembershipStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "paymentStatus" "public"."PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "idCardStatus" "public"."IDCardStatus" NOT NULL DEFAULT 'NOT_CREATED',
    "seatSequence" INTEGER NOT NULL DEFAULT 1,
    "lockedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MembershipPayment" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IDCard" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "status" "public"."IDCardStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IDCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Designation_code_key" ON "public"."Designation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_parentId_key" ON "public"."Designation"("name", "parentId");

-- CreateIndex
CREATE INDEX "Membership_cellId_designationId_level_idx" ON "public"."Membership"("cellId", "designationId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_cellId_designationId_level_hrcCountryId_hrcState_key" ON "public"."Membership"("cellId", "designationId", "level", "hrcCountryId", "hrcStateId", "hrcDistrictId", "hrcMandalId", "seatSequence");

-- CreateIndex
CREATE UNIQUE INDEX "IDCard_membershipId_key" ON "public"."IDCard"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "IDCard_cardNumber_key" ON "public"."IDCard"("cardNumber");

-- AddForeignKey
ALTER TABLE "public"."Designation" ADD CONSTRAINT "Designation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "public"."Cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "public"."Designation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MembershipPayment" ADD CONSTRAINT "MembershipPayment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."IDCard" ADD CONSTRAINT "IDCard_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "public"."Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
