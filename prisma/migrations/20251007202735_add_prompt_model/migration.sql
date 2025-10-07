-- CreateEnum
CREATE TYPE "public"."HrcCellType" AS ENUM ('COMPLAINT_LEGAL_SUPPORT', 'WOMEN_CHILD_RIGHTS', 'SOCIAL_JUSTICE', 'AWARENESS_EDUCATION');

-- AlterTable
ALTER TABLE "public"."HrcTeam" ADD COLUMN     "cellType" "public"."HrcCellType";

-- CreateIndex
CREATE INDEX "HrcTeam_cellType_idx" ON "public"."HrcTeam"("cellType");
