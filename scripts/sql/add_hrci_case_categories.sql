-- HRCI Case Categories (non-destructive add)
CREATE TABLE IF NOT EXISTS "public"."HrcCaseCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "icon" TEXT,
    "color" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HrcCaseCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrcCaseCategory_code_key" ON "public"."HrcCaseCategory"("code");
CREATE INDEX IF NOT EXISTS "HrcCaseCategory_parentId_idx" ON "public"."HrcCaseCategory"("parentId");
CREATE INDEX IF NOT EXISTS "HrcCaseCategory_isActive_order_idx" ON "public"."HrcCaseCategory"("isActive", "order");

ALTER TABLE "public"."HrcCaseCategory"
  ADD CONSTRAINT "HrcCaseCategory_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "public"."HrcCaseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."HrcCaseCategoryMap" (
    "caseId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrcCaseCategoryMap_pkey" PRIMARY KEY ("caseId", "categoryId")
);

CREATE INDEX IF NOT EXISTS "HrcCaseCategoryMap_categoryId_idx" ON "public"."HrcCaseCategoryMap"("categoryId");

ALTER TABLE "public"."HrcCaseCategoryMap"
  ADD CONSTRAINT "HrcCaseCategoryMap_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "public"."HrcCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."HrcCaseCategoryMap"
  ADD CONSTRAINT "HrcCaseCategoryMap_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "public"."HrcCaseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
