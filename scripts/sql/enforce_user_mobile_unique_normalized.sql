-- Enforce uniqueness for User.mobileNumber by NORMALIZED digits (PostgreSQL)
--
-- Why:
--  - Prisma's @unique enforces uniqueness of the raw string only.
--  - Users can be stored as "9876543210", "+919876543210", "0 98765 43210", etc.
--  - This creates a UNIQUE index on the normalized last-10-digits form.
--
-- Safety:
--  - Does NOT delete or modify any data.
--  - It will FAIL (abort) if duplicates already exist by normalized number.
--
-- Suggested pre-check:
--   node scripts/check_mobile_duplicates.js

DO $$
DECLARE dup_count INT;
BEGIN
  -- Count duplicates by normalized 10-digit mobile
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT right(regexp_replace("mobileNumber", '\\D', '', 'g'), 10) AS norm
    FROM "User"
    WHERE "mobileNumber" IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) > 1
  ) t
  WHERE norm IS NOT NULL AND norm <> '';

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce normalized unique mobileNumber: % duplicate(s) found. Run scripts/check_mobile_duplicates.js and merge/cleanup first.', dup_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'User_mobileNumber_norm_key'
  ) THEN
    CREATE UNIQUE INDEX "User_mobileNumber_norm_key"
      ON "User" (right(regexp_replace("mobileNumber", '\\D', '', 'g'), 10))
      WHERE "mobileNumber" IS NOT NULL;
  END IF;
END $$;
