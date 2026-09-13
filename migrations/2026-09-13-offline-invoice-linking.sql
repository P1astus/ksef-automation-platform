-- Offline24 gap: offline_invoices had no write path anywhere in the codebase.
--
-- Problem: 05-offline24-monitor.json (the every-2-hours deadline/alert
-- workflow - CLAUDE.md calls this "the highest-stakes path in the system")
-- exclusively queries offline_invoices. portal/src/app/api/invoices/offline
-- (the dashboard's "Kolejka offline" queue) instead read invoices.is_offline /
-- offline_upload_deadline / offline_uploaded. A repo-wide grep found no
-- INSERT into offline_invoices and nothing ever setting invoices.is_offline
-- anywhere - both tracking paths were permanently empty. The monitor workflow
-- has run every 2 hours finding zero rows regardless of how many invoices
-- were actually issued offline.
--
-- Fix (this migration): give offline_invoices a link back to the real
-- invoice row, so the write path (invoices/create/route.ts, next commit) can
-- insert one linked row per offline invoice, and the read path
-- (invoices/offline/route.ts) can join back to invoices for display fields
-- (seller/buyer/amount) that offline_invoices was never meant to duplicate.
-- invoices.is_offline/offline_upload_deadline/offline_uploaded remain
-- unpopulated dead columns after this - deliberately left alone rather than
-- dropped in the same commit as the fix; a candidate for a follow-up cleanup.

BEGIN;

ALTER TABLE offline_invoices ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);
CREATE INDEX IF NOT EXISTS idx_offline_invoices_invoice_id ON offline_invoices(invoice_id);

COMMIT;
