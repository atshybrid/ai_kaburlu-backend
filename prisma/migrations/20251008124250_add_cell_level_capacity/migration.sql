-- CreateTable
CREATE TABLE "public"."CellLevelCapacity" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "level" "public"."OrgLevel" NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CellLevelCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CellLevelCapacity_cellId_level_key" ON "public"."CellLevelCapacity"("cellId", "level");

-- AddForeignKey
ALTER TABLE "public"."CellLevelCapacity" ADD CONSTRAINT "CellLevelCapacity_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "public"."Cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
