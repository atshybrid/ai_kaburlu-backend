-- CreateTable
CREATE TABLE "public"."TermsAndConditions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "effectiveAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermsAndConditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PrivacyPolicy" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "effectiveAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TermsAndConditions_isActive_idx" ON "public"."TermsAndConditions"("isActive");

-- CreateIndex
CREATE INDEX "TermsAndConditions_language_idx" ON "public"."TermsAndConditions"("language");

-- CreateIndex
CREATE INDEX "TermsAndConditions_version_idx" ON "public"."TermsAndConditions"("version");

-- CreateIndex
CREATE INDEX "PrivacyPolicy_isActive_idx" ON "public"."PrivacyPolicy"("isActive");

-- CreateIndex
CREATE INDEX "PrivacyPolicy_language_idx" ON "public"."PrivacyPolicy"("language");

-- CreateIndex
CREATE INDEX "PrivacyPolicy_version_idx" ON "public"."PrivacyPolicy"("version");
