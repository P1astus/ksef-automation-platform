-- Server-side session revocation. Session JWTs carry the account's
-- session_version; getSession() rejects a token whose version is behind.
-- Password change/reset, login e-mail change and logout increment it.
ALTER TABLE firms ADD COLUMN session_version integer NOT NULL DEFAULT 0;
ALTER TABLE firm_users ADD COLUMN session_version integer NOT NULL DEFAULT 0;

-- Password-reset tokens are stored as SHA-256 from now on. Outstanding tokens
-- were stored in plain text and can no longer be matched; clear them (a user
-- simply requests a new link).
UPDATE firms SET reset_token = NULL, reset_token_expires_at = NULL WHERE reset_token IS NOT NULL;
UPDATE firm_users SET reset_token = NULL, reset_token_expires_at = NULL WHERE reset_token IS NOT NULL;
