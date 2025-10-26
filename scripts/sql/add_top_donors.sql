-- Top Donors support table
CREATE TABLE IF NOT EXISTS "DonationDonorProfile" (
  id VARCHAR(36) PRIMARY KEY,
  name TEXT NULL,
  donorMobile VARCHAR(32) NULL,
  donorEmail TEXT NULL,
  donorPan VARCHAR(16) NULL,
  photoUrl TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (donorMobile),
  UNIQUE (donorEmail),
  UNIQUE (donorPan)
);

CREATE INDEX IF NOT EXISTS idx_ddp_mobile ON "DonationDonorProfile" (donorMobile);
CREATE INDEX IF NOT EXISTS idx_ddp_email ON "DonationDonorProfile" (donorEmail);
CREATE INDEX IF NOT EXISTS idx_ddp_pan ON "DonationDonorProfile" (donorPan);

-- Create or replace function, then (re)create trigger safely
CREATE OR REPLACE FUNCTION set_updated_at_ddp() RETURNS TRIGGER AS $$
BEGIN
  NEW.updatedat = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ddp_updated_at ON "DonationDonorProfile";
CREATE TRIGGER trg_ddp_updated_at BEFORE UPDATE ON "DonationDonorProfile"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at_ddp();
