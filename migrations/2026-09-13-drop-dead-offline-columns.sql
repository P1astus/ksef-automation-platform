-- Cleanup: invoices.is_offline / offline_mode / offline_upload_deadline /
-- offline_uploaded are now confirmed fully dead.
--
-- Round 3's offline24 write-path fix (migrations/2026-09-13-offline-invoice-
-- linking.sql) moved the entire offline-tracking flow onto offline_invoices
-- (linked via invoice_id): invoices/create/route.ts inserts there,
-- invoices/offline/route.ts reads from there, ksef/send/route.ts closes out
-- there. A repo-wide grep after that fix landed found no remaining reader or
-- writer of these four invoices columns anywhere - portal, workflows, or
-- fixtures (stress-test-invoices.sql updated in the same commit as this
-- migration to stop populating them).
--
-- Dropping rather than leaving them: an unpopulated column with a name that
-- strongly suggests it's the live offline-tracking mechanism is exactly the
-- kind of thing that caused round 3's bug in the first place (the portal
-- read from these columns while the monitor workflow read from a different,
-- entirely disconnected table). Removing the dead one closes that trap for
-- good instead of leaving two plausible-looking sources of truth again.

BEGIN;

DROP INDEX IF EXISTS idx_invoices_offline_deadline;

ALTER TABLE invoices
    DROP COLUMN IF EXISTS is_offline,
    DROP COLUMN IF EXISTS offline_mode,
    DROP COLUMN IF EXISTS offline_upload_deadline,
    DROP COLUMN IF EXISTS offline_uploaded;

COMMIT;
