-- Job harness (replaces n8n's scheduler): a durable queue of scheduled occurrences, and a place for alerts to land.
-- Additive (expand-only): safe for an older application still serving during an upgrade.

-- One row per scheduled occurrence of a job. (job_name, occurrence_key) is what makes an occurrence unique; for cron
-- jobs the key is the LOCAL wall-clock label, so a repeated DST hour can never run a job twice.
CREATE TABLE job_occurrences (
    id               BIGSERIAL PRIMARY KEY,
    job_name         TEXT NOT NULL,
    occurrence_key   TEXT NOT NULL,
    scheduled_for    TIMESTAMPTZ NOT NULL,
    state            TEXT NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
    run_after        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_expires_at TIMESTAMPTZ,
    worker_id        TEXT,
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,
    last_error       TEXT,
    result           JSONB,
    -- A shadow occurrence computes and records what it WOULD do and writes nothing else (no markers, no alerts, no mail).
    shadow           BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_name, occurrence_key)
);

CREATE INDEX idx_job_occurrences_claim ON job_occurrences (state, run_after);

-- Overlap prevention as a DATABASE guarantee, not a convention: at most one running occurrence per job, even if two
-- workers race for the same claim. (A 64-bit advisory lock or hashtext would be a weaker, collidable substitute.)
CREATE UNIQUE INDEX one_running_occurrence_per_job ON job_occurrences (job_name) WHERE state = 'running';

-- Alerts: what workflow 01 did (audit_log + mail to a hardcoded address), made durable and visible in the portal.
CREATE TABLE system_alerts (
    id             BIGSERIAL PRIMARY KEY,
    severity       TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    source         TEXT NOT NULL,
    firm_id        INTEGER REFERENCES firms(id) ON DELETE SET NULL,
    client_nip     VARCHAR(10),
    subject        TEXT NOT NULL,
    message        TEXT NOT NULL,
    details        JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at   TIMESTAMPTZ,
    delivery_error TEXT
);

CREATE INDEX idx_system_alerts_created ON system_alerts (created_at DESC);
