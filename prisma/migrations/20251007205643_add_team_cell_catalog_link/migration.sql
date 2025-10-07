-- AlterTable
ALTER TABLE "public"."HrcTeam" ADD COLUMN     "cellCatalogId" TEXT;

-- CreateIndex
CREATE INDEX "HrcTeam_cellCatalogId_idx" ON "public"."HrcTeam"("cellCatalogId");

-- AddForeignKey
ALTER TABLE "public"."HrcTeam" ADD CONSTRAINT "HrcTeam_cellCatalogId_fkey" FOREIGN KEY ("cellCatalogId") REFERENCES "public"."HrcCellCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
