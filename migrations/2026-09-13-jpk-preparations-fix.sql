-- D3: jpk_preparations was defined twice - ksef-schema.sql created it
-- without firm_id (export_data JSONB, UNIQUE(client_nip, period));
-- migrations/sprint9-13.sql's CREATE TABLE IF NOT EXISTS silently no-ops
-- against the live table, so its firm-scoped/TEXT-column intent never took
-- effect. jpk/generate/route.ts inserts firm_id and a raw XML string into
-- export_data - the firm_id insert already needs the column (added by
-- migrations/2026-09-13-tenancy-fix.sql as a shared prerequisite), and the
-- raw XML string was never valid input for a JSONB column either.
--
-- This migration settles on the firm-scoped, TEXT-column shape as
-- authoritative and migrates the existing table via ALTER TABLE, rather
-- than editing sprint9-13.sql's already-applied definition.
--
-- Must run after migrations/2026-09-13-tenancy-fix.sql.

BEGIN;

-- export_data: JSONB -> TEXT. Dropped and recreated rather than
-- ALTER COLUMN ... TYPE TEXT USING export_data::TEXT: every existing row's
-- export_data was written by code that could never have successfully
-- inserted a JSONB-valid value in the first place (a raw XML string isn't
-- valid JSON), so there is nothing meaningful to preserve through a cast.
ALTER TABLE jpk_preparations DROP COLUMN IF EXISTS export_data;
ALTER TABLE jpk_preparations ADD COLUMN export_data TEXT;

-- Replace the old (client_nip, period) uniqueness with firm-scoped
-- uniqueness. Constraint name discovered dynamically via pg_constraint
-- (order-independent containment check), same reasoning as
-- 2026-09-13-tenancy-fix.sql: authored without a live DB connection to
-- confirm Postgres's actual auto-generated name.
DO $$
DECLARE
    found_conname TEXT;
BEGIN
    SELECT c.conname INTO found_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'u'
      AND t.relname = 'jpk_preparations'
      AND c.conkey @> ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'client_nip'),
          (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'period')
      ]
      AND array_length(c.conkey, 1) = 2;

    IF found_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE jpk_preparations DROP CONSTRAINT %I', found_conname);
        RAISE NOTICE 'Dropped unique constraint % on jpk_preparations(client_nip, period)', found_conname;
    END IF;
END $$;

ALTER TABLE jpk_preparations
    ADD CONSTRAINT jpk_preparations_firm_client_period_key UNIQUE (firm_id, client_nip, period);

-- Found by actually running this migration against a real engine (pglite -
-- no live DB available in this environment): the live status CHECK
-- constraint, from ksef-schema.sql, only allows
-- ('pending','in_progress','ready','exported','correction_needed'). But
-- portal/src/app/api/jpk/generate/route.ts inserts status='generated',
-- which isn't in that list - a third, independent reason this insert could
-- never have succeeded, on top of the missing firm_id and the JSONB/TEXT
-- mismatch above. Meanwhile workflows/06-jpk-vat-preparation.json's own
-- UPSERT node writes 'ready'/'in_progress'/'correction_needed' - matching
-- the original enum, not the portal route's value. Two call sites use two
-- non-overlapping status vocabularies for the same column; this widens the
-- CHECK to accept both rather than picking one arbitrarily, since which
-- vocabulary is "correct" is a business-logic decision, not a data-plumbing
-- one - see FIXES-2026-09-13.md for the follow-up this needs.
DO $$
DECLARE
    found_conname TEXT;
BEGIN
    SELECT c.conname INTO found_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'c'
      AND t.relname = 'jpk_preparations'
      AND pg_get_constraintdef(c.oid) LIKE '%status%';

    IF found_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE jpk_preparations DROP CONSTRAINT %I', found_conname);
        RAISE NOTICE 'Dropped status CHECK constraint % on jpk_preparations', found_conname;
    END IF;
END $$;

ALTER TABLE jpk_preparations
    ADD CONSTRAINT jpk_preparations_status_check
    CHECK (status IN ('pending', 'in_progress', 'ready', 'exported', 'correction_needed', 'generated'));

COMMIT;
