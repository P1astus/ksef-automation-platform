-- Rollback for migrations/2026-09-13-tenancy-fix.sql
--
-- First choice for rolling back: restore the pre-migration pg_dump taken
-- before running the forward migration, with the stack stopped. That's a
-- known-good state, not a best-effort reversal. Use this script only if a
-- full dump restore isn't viable (e.g. real writes have already landed under
-- the new schema and a restore would lose them).
--
-- Refuses to run if any client has been given a NIP that a second firm
-- already holds in the interim - restoring the old global UNIQUE(nip) would
-- otherwise fail with a constraint violation and leave the DB in a
-- half-rolled-back state.

BEGIN;

DO $$
DECLARE
    dupe_count INTEGER;
    r RECORD;
BEGIN
    SELECT count(*) INTO dupe_count FROM (
        SELECT nip FROM clients GROUP BY nip HAVING count(DISTINCT firm_id) > 1
    ) dupes;

    IF dupe_count > 0 THEN
        RAISE NOTICE 'The following NIPs are now held by more than one firm - rollback refused:';
        FOR r IN
            SELECT nip, COUNT(DISTINCT firm_id) AS firm_count
            FROM clients GROUP BY nip HAVING count(DISTINCT firm_id) > 1
        LOOP
            RAISE NOTICE '  nip=% held by % firms', r.nip, r.firm_count;
        END LOOP;
        RAISE EXCEPTION 'Rollback aborted: % NIP(s) are shared across firms, restoring the global UNIQUE(nip) would violate it', dupe_count;
    END IF;
END $$;

-- Drop the four composite FKs added by the forward migration.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_firm_client_fkey;
ALTER TABLE offline_invoices DROP CONSTRAINT IF EXISTS offline_invoices_firm_client_fkey;
ALTER TABLE jpk_preparations DROP CONSTRAINT IF EXISTS jpk_preparations_firm_client_fkey;
ALTER TABLE ocr_queue DROP CONSTRAINT IF EXISTS ocr_queue_firm_client_fkey;

-- Drop the new per-firm unique constraint on clients.
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_firm_id_nip_key;

-- Drop firm_id from invoices/offline_invoices/jpk_preparations - only if
-- nothing has come to depend on it since (check before assuming this is
-- safe on a DB that's been live for a while under the new schema).
ALTER TABLE invoices DROP COLUMN IF EXISTS firm_id;
ALTER TABLE offline_invoices DROP COLUMN IF EXISTS firm_id;
ALTER TABLE jpk_preparations DROP COLUMN IF EXISTS firm_id;
-- ocr_queue.firm_id predates this migration (ksef-schema-migration.sql) -
-- not dropped here, only its NOT NULL is relaxed below.
ALTER TABLE ocr_queue ALTER COLUMN firm_id DROP NOT NULL;

-- Restore the original global UNIQUE(nip) on clients.
ALTER TABLE clients ADD CONSTRAINT clients_nip_key UNIQUE (nip);

-- Restore the four original single-column FKs that the forward migration
-- dropped in its step 1.
ALTER TABLE invoices
    ADD CONSTRAINT invoices_client_nip_fkey
    FOREIGN KEY (client_nip) REFERENCES clients(nip);

ALTER TABLE offline_invoices
    ADD CONSTRAINT offline_invoices_client_nip_fkey
    FOREIGN KEY (client_nip) REFERENCES clients(nip);

ALTER TABLE jpk_preparations
    ADD CONSTRAINT jpk_preparations_client_nip_fkey
    FOREIGN KEY (client_nip) REFERENCES clients(nip);

ALTER TABLE ocr_queue
    ADD CONSTRAINT ocr_queue_client_nip_fkey
    FOREIGN KEY (client_nip) REFERENCES clients(nip);

-- Application code (the firm_id filters added to API routes and workflow
-- Postgres nodes) is NOT rolled back by this script - it's backward
-- compatible with this restored schema (WHERE firm_id = $1 AND client_nip =
-- $2 still works fine against a single-tenant-per-NIP world), so no code
-- rollback is needed even after running this.

COMMIT;
