-- Safe DDL to add Donations module without resetting the DB
-- Creates enum, tables, FKs, and indexes if they do not already exist

-- 1) Ensure PaymentIntentType enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentIntentType') THEN
    CREATE TYPE "PaymentIntentType" AS ENUM ('MEMBERSHIP','DONATION');
  END IF;
END$$;

-- 2) Ensure intentType column exists on PaymentIntent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'PaymentIntent'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'PaymentIntent' AND column_name = 'intentType'
    ) THEN
      ALTER TABLE "PaymentIntent" ADD COLUMN "intentType" "PaymentIntentType" NOT NULL DEFAULT 'MEMBERSHIP';
    END IF;
  END IF;
END$$;

-- 3) OrgSetting table
CREATE TABLE IF NOT EXISTS "OrgSetting" (
  id TEXT PRIMARY KEY,
  "orgName" TEXT NOT NULL,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  country TEXT DEFAULT 'India',
  pan TEXT,
  "eightyGNumber" TEXT,
  "eightyGValidFrom" TIMESTAMP(3),
  "eightyGValidTo" TIMESTAMP(3),
  email TEXT,
  phone TEXT,
  website TEXT,
  "authorizedSignatoryName" TEXT,
  "authorizedSignatoryTitle" TEXT,
  "hrciLogoUrl" TEXT,
  "stampRoundUrl" TEXT,
  documents JSONB,
  "createdAt" TIMESTAMP(3) DEFAULT now(),
  "updatedAt" TIMESTAMP(3) DEFAULT now()
);
-- Add new OrgSetting columns if table already existed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OrgSetting' AND column_name = 'id') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OrgSetting' AND column_name = 'hrciLogoUrl') THEN
      ALTER TABLE "OrgSetting" ADD COLUMN "hrciLogoUrl" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OrgSetting' AND column_name = 'stampRoundUrl') THEN
      ALTER TABLE "OrgSetting" ADD COLUMN "stampRoundUrl" TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OrgSetting' AND column_name = 'documents') THEN
      ALTER TABLE "OrgSetting" ADD COLUMN documents JSONB;
    END IF;
  END IF;
END$$;
CREATE INDEX IF NOT EXISTS "OrgSetting_orgName_idx" ON "OrgSetting" ("orgName");

-- 4) DonationEvent table
CREATE TABLE IF NOT EXISTS "DonationEvent" (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  "coverImageUrl" TEXT,
  "goalAmount" INTEGER,
  currency TEXT DEFAULT 'INR',
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  status TEXT DEFAULT 'DRAFT',
  presets INTEGER[] DEFAULT '{}',
  "allowCustom" BOOLEAN DEFAULT TRUE,
  "collectedAmount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP(3) DEFAULT now(),
  "updatedAt" TIMESTAMP(3) DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "DonationEvent_status_time_idx" ON "DonationEvent" (status, "startAt", "endAt");

-- 5) Donation table
CREATE TABLE IF NOT EXISTS "Donation" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'INR',
  "donorName" TEXT,
  "donorMobile" TEXT,
  "donorEmail" TEXT,
  "donorPan" TEXT,
  "isAnonymous" BOOLEAN DEFAULT FALSE,
  "referrerUserId" TEXT,
  status TEXT DEFAULT 'PENDING',
  "providerOrderId" TEXT,
  "providerPaymentId" TEXT,
  "paymentIntentId" TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT now(),
  "updatedAt" TIMESTAMP(3) DEFAULT now(),
  CONSTRAINT "Donation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DonationEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Donation_event_status_idx" ON "Donation" ("eventId", status);

-- 6) DonationShareLink table
CREATE TABLE IF NOT EXISTS "DonationShareLink" (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  code TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  "clicksCount" INTEGER DEFAULT 0,
  "ordersCount" INTEGER DEFAULT 0,
  "successCount" INTEGER DEFAULT 0,
  "createdAt" TIMESTAMP(3) DEFAULT now(),
  "updatedAt" TIMESTAMP(3) DEFAULT now(),
  CONSTRAINT "DonationShareLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DonationEvent"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DonationShareLink_code_key" UNIQUE (code)
);
