-- Owner e-mail verification. A hosted sign-up and a login e-mail change only
-- take effect once the address owner opens a single-use link. Only a SHA-256
-- of the link token is stored.
ALTER TABLE firms
    ADD COLUMN email_verified_at timestamptz,
    ADD COLUMN email_verify_token varchar(64),
    ADD COLUMN email_verify_expires_at timestamptz,
    ADD COLUMN pending_email varchar(255);

-- Accounts that exist before this migration keep working: they were created
-- through the first-run setup token or before verification existed.
UPDATE firms SET email_verified_at = COALESCE(created_at, NOW()) WHERE email_verified_at IS NULL;

CREATE UNIQUE INDEX firms_email_verify_token_key ON firms (email_verify_token) WHERE email_verify_token IS NOT NULL;
