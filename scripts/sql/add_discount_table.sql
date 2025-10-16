CREATE TABLE IF NOT EXISTS "public"."Discount" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT UNIQUE,
  "mobileNumber" TEXT NOT NULL,
  "cell" TEXT,
  "designationCode" TEXT,
  "level" TEXT,
  "zone" TEXT,
  "hrcCountryId" TEXT,
  "hrcStateId" TEXT,
  "hrcDistrictId" TEXT,
  "hrcMandalId" TEXT,
  "amountOff" INTEGER,
  "percentOff" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "maxRedemptions" INTEGER NOT NULL DEFAULT 1,
  "redeemedCount" INTEGER NOT NULL DEFAULT 0,
  "activeFrom" TIMESTAMP(3),
  "activeTo" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "appliedToIntentId" TEXT,
  "createdByUserId" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "Discount_mobile_status_idx" ON "public"."Discount" ("mobileNumber", "status");
CREATE INDEX IF NOT EXISTS "Discount_designation_level_idx" ON "public"."Discount" ("designationCode", "level");
CREATE INDEX IF NOT EXISTS "Discount_geo_idx" ON "public"."Discount" ("hrcStateId", "hrcDistrictId", "hrcMandalId");

-- Note: Partial unique index for (mobileNumber) when status IN ('ACTIVE','RESERVED') is not portable across all environments here.
-- Application layer enforces: only one ACTIVE/RESERVED discount per mobileNumber.
