ALTER TABLE firm_users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64);
ALTER TABLE firm_users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS firm_users_reset_token_key
    ON firm_users(reset_token) WHERE reset_token IS NOT NULL;
