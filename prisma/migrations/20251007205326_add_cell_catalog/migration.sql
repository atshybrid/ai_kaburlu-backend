-- CreateTable
CREATE TABLE "public"."HrcCellCatalog" (
    "id" TEXT NOT NULL,
    "code" "public"."HrcCellType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrcCellCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrcCellCatalog_code_key" ON "public"."HrcCellCatalog"("code");
