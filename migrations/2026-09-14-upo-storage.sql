-- UPO (Urzedowe Poswiadczenie Odbioru) is KSeF's legal proof-of-receipt for
-- a submitted invoice - the record a firm needs if a client's submission is
-- ever questioned in an audit. ksef/send/route.ts (D8's online-session send
-- flow) never retrieved or stored it, and never populated ksef_number,
-- ksef_acquisition_date or ksef_permanent_storage_date either (those three
-- columns already existed, unused, since the base schema/sprint9-13.sql) -
-- it stored sendInvoice()'s session-scoped referenceNumber into
-- offline_invoices.ksef_number as if it were the permanent KSeF number,
-- which it isn't.
--
-- GET /sessions/{referenceNumber}/invoices (ksef-openapi.json) returns, once
-- KSeF has finished processing an invoice, the real ksefNumber plus a
-- pre-signed upoDownloadUrl serving the UPO XML directly. That XML is what
-- gets stored here - the URL itself is time-limited (a few days in the
-- vendored spec's own example), so the content has to be fetched and kept,
-- not just linked to.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS upo_xml TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS upo_reference_number VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS upo_hash VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS upo_retrieved_at TIMESTAMPTZ;
