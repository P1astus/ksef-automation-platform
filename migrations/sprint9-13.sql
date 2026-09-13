-- Sprint 9-13 Migration
-- Run: docker exec -i ksef_db psql -U ksef_app -d ksef_platform < migrations/sprint9-13.sql
-- Or paste into psql session

-- Invoices: allow NULL ksef_number for outbound invoices (they get the number after KSeF accepts)
ALTER TABLE invoices ALTER COLUMN ksef_number DROP NOT NULL;

-- Invoices: new columns
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ksef_submission_date TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_lines JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS kpir_column VARCHAR(5);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_register_field VARCHAR(10);

-- Clients: CRM fields
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tags VARCHAR(500);

-- Team management
CREATE TABLE IF NOT EXISTS firm_users (
    id SERIAL PRIMARY KEY,
    firm_id INT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(20) DEFAULT 'member',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(firm_id, email)
);

CREATE TABLE IF NOT EXISTS invitations (
    id SERIAL PRIMARY KEY,
    firm_id INT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    role VARCHAR(20) DEFAULT 'member',
    accepted BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- JPK generation history
CREATE TABLE IF NOT EXISTS jpk_preparations (
    id SERIAL PRIMARY KEY,
    firm_id INT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    client_nip VARCHAR(20) NOT NULL,
    period VARCHAR(7) NOT NULL,
    export_data TEXT,
    status VARCHAR(20) DEFAULT 'generated',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(firm_id, client_nip, period)
);

SELECT 'Sprint 9-13 migration complete ✓' AS result;
