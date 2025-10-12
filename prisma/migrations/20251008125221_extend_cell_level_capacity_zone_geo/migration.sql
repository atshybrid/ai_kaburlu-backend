/*
  Warnings:

  - A unique constraint covering the columns `[cellId,level,zone,hrcStateId,hrcDistrictId,hrcMandalId]` on the table `CellLevelCapacity` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."CellLevelCapacity_cellId_level_key";

-- AlterTable
ALTER TABLE "public"."CellLevelCapacity" ADD COLUMN     "hrcDistrictId" TEXT,
ADD COLUMN     "hrcMandalId" TEXT,
ADD COLUMN     "hrcStateId" TEXT,
ADD COLUMN     "zone" "public"."HrcZone";

-- CreateIndex
CREATE UNIQUE INDEX "CellLevelCapacity_cellId_level_zone_hrcStateId_hrcDistrictI_key" ON "public"."CellLevelCapacity"("cellId", "level", "zone", "hrcStateId", "hrcDistrictId", "hrcMandalId");
