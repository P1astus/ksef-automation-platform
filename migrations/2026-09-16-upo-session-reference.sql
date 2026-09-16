-- Round 6: lets a UPO be re-fetched later if the pre-signed upoDownloadUrl
-- from getSessionInvoiceStatus() expired before pollAndStoreUpo() (in
-- ksef/send/route.ts) got to it. KSeF's authenticated retry endpoint —
-- GET /sessions/{referenceNumber}/invoices/ksef/{ksefNumber}/upo
-- (ksef-openapi.json) — needs the *online session's* reference number, not
-- just the invoice's permanent ksef_number, and nothing previously
-- persisted it once the session was closed.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ksef_session_reference_number VARCHAR(64);
