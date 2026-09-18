-- Round 16: vendor/admin console. Operators are the people who run this
-- platform across firms - deliberately a separate identity from firms/
-- firm_users so a tenant session can never reach /admin. There is no
-- self-registration: rows are created with portal/scripts/create-operator.mjs.

CREATE TABLE IF NOT EXISTS operators (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Every operator login attempt and every view of tenant data. operator_id is
-- NULL for a failed login (no operator was identified); the attempted email is
-- kept so repeated guessing is visible. Append-only by convention.
CREATE TABLE IF NOT EXISTS operator_audit_log (
    id             BIGSERIAL PRIMARY KEY,
    operator_id    INTEGER REFERENCES operators(id),
    operator_email VARCHAR(255),
    action         VARCHAR(50) NOT NULL,
    firm_id        INTEGER,
    ip             VARCHAR(64),
    details        JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operator_audit_created ON operator_audit_log (created_at DESC);
