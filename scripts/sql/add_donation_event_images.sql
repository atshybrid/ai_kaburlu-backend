-- Create DonationEventImage table if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'donationeventimage'
  ) THEN
    CREATE TABLE "DonationEventImage" (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      "eventId" text NOT NULL,
      url text NOT NULL,
      caption text NULL,
      "order" integer NOT NULL DEFAULT 0,
      "isActive" boolean NOT NULL DEFAULT true,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS donationeventimage_event_idx ON "DonationEventImage" ("eventId", "isActive", "order");
  END IF;
END $$;

-- Add FK if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'DonationEventImage_eventId_fkey'
  ) THEN
    ALTER TABLE "DonationEventImage"
      ADD CONSTRAINT "DonationEventImage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DonationEvent"(id) ON DELETE CASCADE;
  END IF;
END $$;
