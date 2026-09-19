-- ZUS DRA/RCA import register. This is deliberately a document-management
-- layer, not a claim of direct EWD submission: production EWD needs ZUS
-- acceptance testing and a qualified signature.
CREATE TABLE IF NOT EXISTS zus_declarations (
    id BIGSERIAL PRIMARY KEY,
    firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    client_nip VARCHAR(20) NOT NULL,
    period VARCHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    document_types TEXT[] NOT NULL CHECK (cardinality(document_types) > 0),
    source_filename VARCHAR(255) NOT NULL,
    source_xml TEXT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'imported'
        CHECK (status IN ('imported', 'ready_for_export', 'exported')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exported_at TIMESTAMPTZ,
    UNIQUE (firm_id, client_nip, period, sha256)
);

CREATE INDEX IF NOT EXISTS idx_zus_declarations_firm_created
    ON zus_declarations (firm_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zus_declaration_events (
    id BIGSERIAL PRIMARY KEY,
    declaration_id BIGINT NOT NULL REFERENCES zus_declarations(id) ON DELETE CASCADE,
    firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('imported', 'downloaded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zus_declaration_events_firm_created
    ON zus_declaration_events (firm_id, created_at DESC);
