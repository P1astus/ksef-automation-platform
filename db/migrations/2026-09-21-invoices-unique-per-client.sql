-- One stored copy of a KSeF invoice per (firm, client, KSeF number): the key the invoice-retrieval job's
-- ON CONFLICT (firm_id, client_nip, ksef_number) DO NOTHING relies on.
--
-- Why per CLIENT, not just per firm: an accounting firm's clients trade with each other. One KSeF invoice between two
-- clients of the same firm is legitimately TWO rows (a sale for the seller client, a purchase for the buyer client).
-- A (firm_id, ksef_number) key would silently keep only the first one and drop the other client's row from its JPK.
--
-- Expand-only (safe for an older application still serving during an upgrade): this ADDS a constraint. The old global
-- UNIQUE (ksef_number) stays until db/contract/2026-09-21-drop-global-ksef-number-unique.sql is promoted, because n8n's
-- workflow 04 and the stress-test fixtures still use ON CONFLICT (ksef_number), which needs that index to exist.
--
-- STOPS AND REPORTS on existing duplicates. It never deduplicates: which copy to keep is a decision about tax data.
DO $$
DECLARE
    dup_groups integer;
    dup_sample text;
BEGIN
    SELECT count(*), string_agg(format('firm %s client %s ksef %s x%s', firm_id, client_nip, ksef_number, n), '; ')
      INTO dup_groups, dup_sample
      FROM (
          SELECT firm_id, client_nip, ksef_number, count(*) AS n
            FROM invoices
           WHERE ksef_number IS NOT NULL
           GROUP BY firm_id, client_nip, ksef_number
          HAVING count(*) > 1
           ORDER BY count(*) DESC, firm_id, client_nip, ksef_number
           LIMIT 20
      ) d;
    IF dup_groups > 0 THEN
        RAISE EXCEPTION 'invoices already holds duplicate (firm_id, client_nip, ksef_number) rows; refusing to add the unique constraint. First %: %. Resolve them by hand (decide which copy is authoritative), then re-run.', dup_groups, dup_sample;
    END IF;
END $$;

ALTER TABLE invoices ADD CONSTRAINT invoices_firm_client_ksef_key UNIQUE (firm_id, client_nip, ksef_number);
