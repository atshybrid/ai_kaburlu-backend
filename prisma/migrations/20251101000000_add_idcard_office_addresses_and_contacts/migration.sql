-- Add office addresses and contact numbers to IdCardSetting
ALTER TABLE "IdCardSetting" ADD COLUMN "regionalOfficeAddress" TEXT;
ALTER TABLE "IdCardSetting" ADD COLUMN "administrationOfficeAddress" TEXT;
ALTER TABLE "IdCardSetting" ADD COLUMN "contactNumber1" TEXT;
ALTER TABLE "IdCardSetting" ADD COLUMN "contactNumber2" TEXT;