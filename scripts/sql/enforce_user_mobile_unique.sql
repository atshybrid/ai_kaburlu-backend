-- Enforce uniqueness for User.mobileNumber (PostgreSQL)
-- Safe to run multiple times.
-- Note: this will fail if you currently have duplicate non-null mobileNumber values.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_indexes
    WHERE  schemaname = 'public'
    AND    indexname  = 'User_mobileNumber_key'
  ) THEN
    CREATE UNIQUE INDEX "User_mobileNumber_key" ON "User" ("mobileNumber")
      WHERE "mobileNumber" IS NOT NULL;
  END IF;
END $$;
