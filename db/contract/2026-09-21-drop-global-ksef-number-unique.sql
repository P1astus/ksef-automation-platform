-- CONTRACT step for db/migrations/2026-09-21-invoices-unique-per-client.sql. NOT in db/migrations/manifest.json on purpose.
--
-- Promote it (copy into db/migrations/ and list it in the manifest) only when ALL of these hold:
--   * every deployment has already applied 2026-09-21-invoices-unique-per-client.sql;
--   * n8n workflow 04 is retired (its INSERT ... ON CONFLICT (ksef_number) needs the index dropped here);
--   * stress-test-invoices.sql no longer uses ON CONFLICT (ksef_number);
--   * no application release still serving uses ON CONFLICT (ksef_number).
-- After this, two firms (buyer and seller both on the platform) can each hold their own copy of one KSeF invoice; until then
-- the retrieval job fails loudly (unique violation) for a KSeF number another firm already stores, rather than dropping it.
ALTER TABLE invoices DROP CONSTRAINT invoices_ksef_number_key;
