-- AlterTable
ALTER TABLE "public"."HrcIdCard" ADD COLUMN     "planId" TEXT;

-- CreateTable
CREATE TABLE "public"."HrcIdCardPlan" (
    "id" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "renewalDays" INTEGER NOT NULL,
    "hierarchyLevel" "public"."TeamScopeLevel",
    "stateId" TEXT,
    "districtId" TEXT,
    "mandalId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcIdCardPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrcIdCardPlan_hierarchyLevel_idx" ON "public"."HrcIdCardPlan"("hierarchyLevel");

-- CreateIndex
CREATE INDEX "HrcIdCardPlan_stateId_idx" ON "public"."HrcIdCardPlan"("stateId");

-- CreateIndex
CREATE INDEX "HrcIdCardPlan_districtId_idx" ON "public"."HrcIdCardPlan"("districtId");

-- CreateIndex
CREATE INDEX "HrcIdCardPlan_mandalId_idx" ON "public"."HrcIdCardPlan"("mandalId");

-- CreateIndex
CREATE INDEX "HrcIdCardPlan_active_idx" ON "public"."HrcIdCardPlan"("active");

-- CreateIndex
CREATE INDEX "HrcIdCard_planId_idx" ON "public"."HrcIdCard"("planId");

-- AddForeignKey
ALTER TABLE "public"."HrcIdCardPlan" ADD CONSTRAINT "HrcIdCardPlan_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "public"."State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcIdCardPlan" ADD CONSTRAINT "HrcIdCardPlan_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "public"."District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcIdCardPlan" ADD CONSTRAINT "HrcIdCardPlan_mandalId_fkey" FOREIGN KEY ("mandalId") REFERENCES "public"."Mandal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HrcIdCard" ADD CONSTRAINT "HrcIdCard_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."HrcIdCardPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
