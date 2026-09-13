-- D1 + D2: multi-tenancy fix
--
-- Problem: clients.nip is globally UNIQUE (ksef-schema.sql), so two accounting
-- firms can never both serve the same company NIP (normal in Poland - a
-- company can switch accountants), and a failed registration for a NIP
-- already held by another firm leaks that fact across tenants. Several
-- queries (e.g. portal/src/app/api/jpk/generate/route.ts's invoice fetch)
-- filter only by client_nip with no firm_id check, and are only safe today
-- because nip is globally unique - the moment that constraint is relaxed,
-- those queries can return another firm's rows.
--
-- Fix: drop the global UNIQUE(nip), replace it with UNIQUE(firm_id, nip), and
-- denormalize firm_id directly onto invoices and offline_invoices so tenant
-- isolation does not depend on a join being remembered in every query.
-- ocr_queue already has firm_id (ksef-schema-migration.sql). jpk_preparations
-- needs firm_id too (D3), and its FK to clients(nip) has to be dropped and
-- re-added in this same transaction as clients.nip's own constraint change -
-- that schema mechanic is handled here; D3's own commit handles the
-- application-level fix (the swallowed insert failure, the duplicate table
-- definition, and export_data's JSONB/TEXT mismatch - see that commit).
--
-- HOW TO RUN:
--   1. Stop the stack: docker compose stop
--   2. Take a dump: pg_dump -h localhost -p 5433 -U ksef_app -d ksef_platform \
--        -f backups/<date>-pre-tenancy-fix.pg_dump
--   3. Restart just ksef_db: docker compose up -d ksef_db
--   4. Apply: docker exec -i ksef_db psql -U ksef_app -d ksef_platform \
--        < migrations/2026-09-13-tenancy-fix.sql
--   5. Restart the full stack.
--
-- Every existing NIP is still unique at the moment this migration runs (no
-- second firm has had the chance to register a duplicate yet), so the
-- backfill join below is unambiguous - this is the one moment that's
-- guaranteed true.
--
-- Constraint names are looked up dynamically via pg_constraint rather than
-- hardcoded, since this migration was authored without a live connection to
-- confirm Postgres's actual auto-generated names.

BEGIN;

-- Step 1: drop every FK that references clients(nip), on each of the four
-- dependent tables, whatever it's actually named. Postgres will not let us
-- drop clients' unique(nip) while any of these still reference it.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname, t.relname AS table_name
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_class ft ON ft.oid = c.confrelid
        WHERE c.contype = 'f'
          AND ft.relname = 'clients'
          AND t.relname IN ('invoices', 'offline_invoices', 'jpk_preparations', 'ocr_queue')
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.conname);
        RAISE NOTICE 'Dropped FK % on table %', r.conname, r.table_name;
    END LOOP;
END $$;

-- Step 2: drop the global UNIQUE(nip) on clients, whatever it's named.
DO $$
DECLARE
    found_conname TEXT;
BEGIN
    SELECT c.conname INTO found_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.contype = 'u'
      AND t.relname = 'clients'
      AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'nip')
      ];

    IF found_conname IS NULL THEN
        RAISE EXCEPTION 'Could not find the UNIQUE constraint on clients.nip - aborting migration';
    END IF;

    EXECUTE format('ALTER TABLE clients DROP CONSTRAINT %I', found_conname);
    RAISE NOTICE 'Dropped unique constraint % on clients.nip', found_conname;
END $$;

-- Step 3: add firm_id directly to invoices and offline_invoices (nullable
-- for now - backfilled in step 4, NOT NULL enforced in step 5). ocr_queue
-- already has a nullable firm_id (ksef-schema-migration.sql) but it was never
-- backfilled - included below so no row is left NULL. jpk_preparations gets
-- firm_id here too (shared prerequisite with D3's own fix).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id);
ALTER TABLE offline_invoices ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id);
ALTER TABLE jpk_preparations ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id);

-- Step 4: backfill from the (still, at this instant, unique) clients.nip.
-- Orphaned client_nip rows (no matching client) are surfaced, not silently
-- left NULL - the NOT NULL in step 5 will fail loudly if any remain.
UPDATE invoices i SET firm_id = c.firm_id
FROM clients c WHERE c.nip = i.client_nip AND i.firm_id IS NULL;

UPDATE offline_invoices o SET firm_id = c.firm_id
FROM clients c WHERE c.nip = o.client_nip AND o.firm_id IS NULL;

UPDATE jpk_preparations j SET firm_id = c.firm_id
FROM clients c WHERE c.nip = j.client_nip AND j.firm_id IS NULL;

UPDATE ocr_queue q SET firm_id = c.firm_id
FROM clients c WHERE c.nip = q.client_nip AND q.firm_id IS NULL;

DO $$
DECLARE
    orphaned_invoices INTEGER;
    orphaned_offline INTEGER;
    orphaned_jpk INTEGER;
    orphaned_ocr INTEGER;
BEGIN
    SELECT count(*) INTO orphaned_invoices FROM invoices WHERE firm_id IS NULL;
    SELECT count(*) INTO orphaned_offline FROM offline_invoices WHERE firm_id IS NULL;
    SELECT count(*) INTO orphaned_jpk FROM jpk_preparations WHERE firm_id IS NULL;
    SELECT count(*) INTO orphaned_ocr FROM ocr_queue WHERE firm_id IS NULL;

    IF orphaned_invoices > 0 OR orphaned_offline > 0 OR orphaned_jpk > 0 OR orphaned_ocr > 0 THEN
        RAISE EXCEPTION
            'Backfill left orphaned rows with no matching client (invoices: %, offline_invoices: %, jpk_preparations: %, ocr_queue: %) - these client_nip values do not exist in clients. Resolve manually before re-running.',
            orphaned_invoices, orphaned_offline, orphaned_jpk, orphaned_ocr;
    END IF;
END $$;

-- Step 5: now safe to enforce NOT NULL.
ALTER TABLE invoices ALTER COLUMN firm_id SET NOT NULL;
ALTER TABLE offline_invoices ALTER COLUMN firm_id SET NOT NULL;
ALTER TABLE jpk_preparations ALTER COLUMN firm_id SET NOT NULL;
ALTER TABLE ocr_queue ALTER COLUMN firm_id SET NOT NULL;

-- Step 6: the new per-firm unique constraint on clients.
ALTER TABLE clients ADD CONSTRAINT clients_firm_id_nip_key UNIQUE (firm_id, nip);

-- Step 7: re-establish referential integrity that step 1 removed, now as a
-- composite FK against the new (firm_id, nip) unique key - this is what
-- makes client_nip safe to use as a join key again now that it no longer
-- identifies a single client on its own.
ALTER TABLE invoices
    ADD CONSTRAINT invoices_firm_client_fkey
    FOREIGN KEY (firm_id, client_nip) REFERENCES clients(firm_id, nip);

ALTER TABLE offline_invoices
    ADD CONSTRAINT offline_invoices_firm_client_fkey
    FOREIGN KEY (firm_id, client_nip) REFERENCES clients(firm_id, nip);

ALTER TABLE jpk_preparations
    ADD CONSTRAINT jpk_preparations_firm_client_fkey
    FOREIGN KEY (firm_id, client_nip) REFERENCES clients(firm_id, nip);

ALTER TABLE ocr_queue
    ADD CONSTRAINT ocr_queue_firm_client_fkey
    FOREIGN KEY (firm_id, client_nip) REFERENCES clients(firm_id, nip);

-- Step 8: indexes for the new firm_id columns / composite FKs.
CREATE INDEX IF NOT EXISTS idx_invoices_firm ON invoices(firm_id);
CREATE INDEX IF NOT EXISTS idx_offline_invoices_firm ON offline_invoices(firm_id);
CREATE INDEX IF NOT EXISTS idx_jpk_preparations_firm ON jpk_preparations(firm_id);

COMMIT;
