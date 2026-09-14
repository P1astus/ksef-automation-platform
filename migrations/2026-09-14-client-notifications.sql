-- Client-facing notifications: offline_invoices could only ever alert this
-- platform's own ops channel (alert_sent_4h/1h/overdue -> 01-send-alert.json)
-- - the taxpayer who actually owns the offline24 deadline never heard about
-- it. Separate columns from alert_sent_* on purpose: "did ops get paged"
-- and "did the client get emailed" are different signals with potentially
-- different timing/retry needs; conflating them risks silently dropping one
-- channel if the other's assumptions ever change.
ALTER TABLE offline_invoices ADD COLUMN IF NOT EXISTS client_notified_4h BOOLEAN DEFAULT false;
ALTER TABLE offline_invoices ADD COLUMN IF NOT EXISTS client_notified_1h BOOLEAN DEFAULT false;
ALTER TABLE offline_invoices ADD COLUMN IF NOT EXISTS client_notified_overdue BOOLEAN DEFAULT false;

-- Document requests: a firm-scoped, expiring, no-login upload link a firm
-- can send its client (see /upload/[token]). Mirrors invitations's exact
-- shape/pattern, but reusable until expiry rather than single-use - a
-- client may upload several documents over a few days, unlike a one-time
-- invite acceptance.
CREATE TABLE IF NOT EXISTS document_requests (
    id SERIAL PRIMARY KEY,
    firm_id INT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    client_id INT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    message TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_requests_token ON document_requests(token);
