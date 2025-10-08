-- Drop HRC module tables and dependent enums.
-- IMPORTANT: This is destructive. Back up data if needed before running.

BEGIN;

-- 1. Drop FK-dependent tables first
DROP TABLE IF EXISTS "HrcCaseAttachment" CASCADE;
DROP TABLE IF EXISTS "HrcCaseUpdate" CASCADE;
DROP TABLE IF EXISTS "HrcCase" CASCADE;
DROP TABLE IF EXISTS "HrcTeamMember" CASCADE;
DROP TABLE IF EXISTS "HrcIdCard" CASCADE;
DROP TABLE IF EXISTS "HrcDonation" CASCADE;
DROP TABLE IF EXISTS "HrcIdCardPlan" CASCADE;
DROP TABLE IF EXISTS "HrcVolunteerProfile" CASCADE;
DROP TABLE IF EXISTS "HrcTeam" CASCADE;
DROP TABLE IF EXISTS "HrcCellCatalog" CASCADE;
DROP TABLE IF EXISTS "PaymentTransaction" CASCADE;
DROP TABLE IF EXISTS "PaymentFeeConfig" CASCADE;
DROP TABLE IF EXISTS "RazorpayWebhookEvent" CASCADE;

-- 2. Drop enums (PostgreSQL enum types) if they exist
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (
        SELECT typname FROM pg_type WHERE typname IN (
            'casestatus','casepriority','paymentpurpose','paymentstatus','teamscopelevel','idcardstatus','hrcteammemberrole','hrccelltype'
        )
    ) LOOP
        EXECUTE format('DROP TYPE IF EXISTS %I CASCADE;', rec.typname);
    END LOOP;
END $$;

COMMIT;

-- Verification query suggestion:
-- SELECT table_name FROM information_schema.tables WHERE table_name ILIKE 'hrc%' OR table_name ILIKE 'payment%' OR table_name ILIKE 'razorpay%';
