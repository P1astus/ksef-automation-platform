-- Operator-initiated submissions to the Ministry of Finance JPK TEST gateway.
-- This is an audit trail, not a replacement for keeping the generated XML.
-- There is deliberately no production-gateway equivalent.

BEGIN;

CREATE TABLE IF NOT EXISTS jpk_test_submissions (
    id SERIAL PRIMARY KEY,
    firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    client_nip VARCHAR(20) NOT NULL,
    period VARCHAR(7) NOT NULL CHECK (period ~ '^\\d{4}-\\d{2}$'),
    requested_by TEXT NOT NULL,
    reference_number VARCHAR(128),
    status VARCHAR(20) NOT NULL CHECK (status IN ('submitting', 'processing', 'accepted', 'rejected', 'error')),
    gateway_code INTEGER,
    gateway_description TEXT,
    gateway_details TEXT,
    gateway_upo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_jpk_test_submissions_firm_client_created
    ON jpk_test_submissions (firm_id, client_nip, created_at DESC);

COMMIT;
