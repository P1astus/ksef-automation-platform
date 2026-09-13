-- KSeF SaaS Migration: Add multi-tenancy support
-- Run against the ksef_platform database

-- 1. Create firms table (your SaaS customers - accounting firms)
CREATE TABLE IF NOT EXISTS firms (
    id SERIAL PRIMARY KEY,
    firm_name VARCHAR(512) NOT NULL,
    firm_nip VARCHAR(10) UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    subscription_tier VARCHAR(20) NOT NULL DEFAULT 'start'
        CHECK (subscription_tier IN ('start', 'biznes', 'pro', 'enterprise')),
    max_clients INTEGER NOT NULL DEFAULT 15,
    admin_email VARCHAR(255) NOT NULL UNIQUE,
    admin_password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    trial_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add firm_id to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id);
CREATE INDEX IF NOT EXISTS idx_clients_firm ON clients(firm_id);

-- 3. Add firm_id to audit_log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id);

-- 4. Add firm_id to ocr_queue
ALTER TABLE ocr_queue ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id);

-- 5. Create sessions table for portal auth
CREATE TABLE IF NOT EXISTS portal_sessions (
    id SERIAL PRIMARY KEY,
    firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON portal_sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON portal_sessions(expires_at);
