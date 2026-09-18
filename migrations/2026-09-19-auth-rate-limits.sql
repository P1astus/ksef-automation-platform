CREATE TABLE IF NOT EXISTS auth_rate_limits (
    scope VARCHAR(40) NOT NULL,
    subject_hash VARCHAR(64) NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (scope, subject_hash)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx ON auth_rate_limits(window_started_at);
