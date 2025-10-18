-- Safe creation of HRCI Meeting tables and enum without data loss
-- Postgres-compatible, idempotent creation

-- 1) Create MeetingStatus enum if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'MeetingStatus'
  ) THEN
    CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED','LIVE','ENDED','CANCELLED');
  END IF;
END $$;

-- 2) Create Meeting table if missing
CREATE TABLE IF NOT EXISTS "Meeting" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'JITSI',
  "domain" TEXT NOT NULL DEFAULT 'meet.jit.si',
  "roomName" TEXT NOT NULL,
  "password" TEXT,
  "level" "OrgLevel" NOT NULL,
  "cellId" TEXT NOT NULL,
  "includeChildren" BOOLEAN NOT NULL DEFAULT FALSE,
  "zone" "HrcZone",
  "hrcCountryId" TEXT,
  "hrcStateId" TEXT,
  "hrcDistrictId" TEXT,
  "hrcMandalId" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "createdByUserId" TEXT NOT NULL,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FKs for Meeting (idempotent via constraint existence check)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "Meeting"
    ADD CONSTRAINT "Meeting_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_cellId_fkey'
  ) THEN
    ALTER TABLE "Meeting"
    ADD CONSTRAINT "Meeting_cellId_fkey" FOREIGN KEY ("cellId") REFERENCES "Cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes for Meeting
CREATE INDEX IF NOT EXISTS "Meeting_level_cellId_idx" ON "Meeting"("level", "cellId");
CREATE INDEX IF NOT EXISTS "Meeting_status_scheduledAt_idx" ON "Meeting"("status", "scheduledAt");

-- 3) Create MeetingParticipant table if missing
CREATE TABLE IF NOT EXISTS "MeetingParticipant" (
  "id" TEXT PRIMARY KEY,
  "meetingId" TEXT NOT NULL,
  "userId" TEXT,
  "role" TEXT NOT NULL,
  "displayName" TEXT,
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3)
);

-- FKs for MeetingParticipant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MeetingParticipant_meetingId_fkey'
  ) THEN
    ALTER TABLE "MeetingParticipant"
    ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MeetingParticipant_userId_fkey'
  ) THEN
    ALTER TABLE "MeetingParticipant"
    ADD CONSTRAINT "MeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes for MeetingParticipant
CREATE INDEX IF NOT EXISTS "MeetingParticipant_meetingId_idx" ON "MeetingParticipant"("meetingId");
CREATE INDEX IF NOT EXISTS "MeetingParticipant_userId_idx" ON "MeetingParticipant"("userId");
