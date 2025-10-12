/*
  Warnings:

  - A unique constraint covering the columns `[cellId,designationId,level,zone,hrcCountryId,hrcStateId,hrcDistrictId,hrcMandalId,seatSequence]` on the table `Membership` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Membership_cellId_designationId_level_hrcCountryId_hrcState_key";

-- AlterTable
ALTER TABLE "public"."Membership" ADD COLUMN     "zone" "public"."HrcZone";

-- CreateIndex
CREATE UNIQUE INDEX "Membership_cellId_designationId_level_zone_hrcCountryId_hrc_key" ON "public"."Membership"("cellId", "designationId", "level", "zone", "hrcCountryId", "hrcStateId", "hrcDistrictId", "hrcMandalId", "seatSequence");
