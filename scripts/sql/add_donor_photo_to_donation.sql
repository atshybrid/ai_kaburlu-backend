-- Add donorPhotoUrl column to Donation table (safe)
ALTER TABLE "Donation"
  ADD COLUMN IF NOT EXISTS "donorPhotoUrl" TEXT;

-- No trigger required; updatedAt is managed by Prisma on updates
