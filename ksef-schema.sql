-- KSeF Automation Platform - PostgreSQL Schema
-- Database: ksef_platform

CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    client_name VARCHAR(512) NOT NULL,
    nip VARCHAR(10) NOT NULL UNIQUE,
    auth_method VARCHAR(20) NOT NULL CHECK (auth_method IN ('token', 'certificate')),
    ksef_token_encrypted TEXT,
    certificate_id VARCHAR(255),
    certificate_expiry TIMESTAMP WITH TIME ZONE,
    permission_level VARCHAR(50) NOT NULL DEFAULT 'read_write',
    hwm_sales TIMESTAMP WITH TIME ZONE,
    hwm_purchases TIMESTAMP WITH TIME ZONE,
    last_sync_success TIMESTAMP WITH TIME ZONE,
    last_sync_error TEXT,
    sync_enabled BOOLEAN NOT NULL DEFAULT true,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    monthly_invoice_volume INTEGER DEFAULT 0,
    preferred_session_mode VARCHAR(20) NOT NULL DEFAULT 'interactive'
        CHECK (preferred_session_mode IN ('interactive', 'batch')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    client_nip VARCHAR(10) NOT NULL REFERENCES clients(nip),
    ksef_number VARCHAR(40) NOT NULL UNIQUE,
    invoice_number VARCHAR(256),
    invoice_type VARCHAR(20),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('sales', 'purchase')),
    seller_nip VARCHAR(10),
    seller_name VARCHAR(512),
    buyer_nip VARCHAR(10),
    buyer_name VARCHAR(512),
    net_amount DECIMAL(15,2),
    vat_amount DECIMAL(15,2),
    gross_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'PLN',
    issue_date DATE,
    delivery_date DATE,
    ksef_acquisition_date TIMESTAMP WITH TIME ZONE,
    ksef_permanent_storage_date TIMESTAMP WITH TIME ZONE,
    processing_status VARCHAR(30) NOT NULL DEFAULT 'new'
        CHECK (processing_status IN ('new', 'classified', 'exported_jpk', 'error', 'duplicate')),
    cost_category VARCHAR(100),
    vat_deductible BOOLEAN,
    classification_confidence DECIMAL(3,2),
    jpk_marker VARCHAR(10) CHECK (jpk_marker IN ('NrKSeF', 'OFF', 'BFK', 'DI')),
    jpk_period VARCHAR(7),
    jpk_correction_needed BOOLEAN DEFAULT false,
    jpk_correction_done BOOLEAN DEFAULT false,
    is_offline BOOLEAN DEFAULT false,
    offline_mode VARCHAR(20)
        CHECK (offline_mode IN ('offline24', 'unavailability', 'emergency', 'total_outage')),
    offline_upload_deadline TIMESTAMP WITH TIME ZONE,
    offline_uploaded BOOLEAN DEFAULT false,
    raw_xml TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_invoices_client_nip ON invoices(client_nip);
CREATE INDEX idx_invoices_ksef_number ON invoices(ksef_number);
CREATE INDEX idx_invoices_processing_status ON invoices(processing_status);
CREATE INDEX idx_invoices_jpk_period ON invoices(jpk_period);
CREATE INDEX idx_invoices_offline_deadline ON invoices(offline_upload_deadline) WHERE offline_uploaded = false;
CREATE INDEX idx_invoices_direction ON invoices(direction);

CREATE TABLE offline_invoices (
    id SERIAL PRIMARY KEY,
    client_nip VARCHAR(10) NOT NULL REFERENCES clients(nip),
    invoice_number VARCHAR(256) NOT NULL,
    offline_mode VARCHAR(20) NOT NULL,
    issue_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    upload_deadline TIMESTAMP WITH TIME ZONE NOT NULL,
    uploaded_to_ksef BOOLEAN DEFAULT false,
    ksef_number VARCHAR(40),
    upload_attempts INTEGER DEFAULT 0,
    last_attempt_error TEXT,
    alert_sent_4h BOOLEAN DEFAULT false,
    alert_sent_1h BOOLEAN DEFAULT false,
    alert_sent_overdue BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_offline_pending ON offline_invoices(upload_deadline) WHERE uploaded_to_ksef = false;

CREATE TABLE jpk_preparations (
    id SERIAL PRIMARY KEY,
    client_nip VARCHAR(10) NOT NULL REFERENCES clients(nip),
    period VARCHAR(7) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'ready', 'exported', 'correction_needed')),
    total_invoices INTEGER DEFAULT 0,
    nr_ksef_count INTEGER DEFAULT 0,
    off_count INTEGER DEFAULT 0,
    bfk_count INTEGER DEFAULT 0,
    di_count INTEGER DEFAULT 0,
    di_resolved_count INTEGER DEFAULT 0,
    export_data JSONB,
    generated_at TIMESTAMP WITH TIME ZONE,
    exported_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(client_nip, period)
);

CREATE TABLE ocr_queue (
    id SERIAL PRIMARY KEY,
    client_nip VARCHAR(10) NOT NULL REFERENCES clients(nip),
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('email', 'upload', 'webhook')),
    file_path TEXT NOT NULL,
    file_type VARCHAR(10),
    ocr_status VARCHAR(20) NOT NULL DEFAULT 'queued'
        CHECK (ocr_status IN ('queued', 'processing', 'completed', 'failed', 'manual_review')),
    extracted_data JSONB,
    confidence_score DECIMAL(3,2),
    matched_ksef_number VARCHAR(40),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    client_nip VARCHAR(10),
    action VARCHAR(50) NOT NULL,
    workflow_name VARCHAR(100),
    execution_id VARCHAR(255),
    details JSONB,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_client ON audit_log(client_nip, created_at);

CREATE TABLE system_health (
    id SERIAL PRIMARY KEY,
    check_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    details JSONB,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE business_days (
    date DATE PRIMARY KEY,
    is_business_day BOOLEAN NOT NULL,
    holiday_name VARCHAR(100)
);

CREATE OR REPLACE FUNCTION next_business_day(from_date DATE) RETURNS DATE AS $$
DECLARE
    check_date DATE := from_date + 1;
BEGIN
    WHILE NOT EXISTS (
        SELECT 1 FROM business_days WHERE date = check_date AND is_business_day = true
    ) LOOP
        check_date := check_date + 1;
    END LOOP;
    RETURN check_date;
END;
$$ LANGUAGE plpgsql;
