-- Create Donation Success Stories tables (safe)
CREATE TABLE IF NOT EXISTS "DonationSuccessStory" (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  "heroImageUrl" TEXT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "DonationSuccessImage" (
  id VARCHAR(36) PRIMARY KEY,
  "storyId" VARCHAR(36) NOT NULL REFERENCES "DonationSuccessStory"(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dss_active ON "DonationSuccessStory" ("isActive");
CREATE INDEX IF NOT EXISTS idx_dsi_story ON "DonationSuccessImage" ("storyId");
CREATE INDEX IF NOT EXISTS idx_dsi_order ON "DonationSuccessImage" ("storyId", "order");

-- Triggers to update updatedAt automatically (Postgres) - safe re-create
CREATE OR REPLACE FUNCTION set_updated_at_dss() RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dss_updated_at ON "DonationSuccessStory";
CREATE TRIGGER trg_dss_updated_at BEFORE UPDATE ON "DonationSuccessStory"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at_dss();

CREATE OR REPLACE FUNCTION set_updated_at_dsi() RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dsi_updated_at ON "DonationSuccessImage";
CREATE TRIGGER trg_dsi_updated_at BEFORE UPDATE ON "DonationSuccessImage"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at_dsi();
