-- One-time first-run setup token for the local edition. Only the SHA-256 of the token is stored; the raw value
-- is shown once by scripts/setup-token.mjs and never retained. Consumed atomically with the first firm insert.
-- Additive (expand-only): safe for an older application still serving during an upgrade.
CREATE TABLE setup_token (
    id          SERIAL PRIMARY KEY,
    token_hash  CHAR(64) NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ
);
