-- Migration v2: Add onboarding, password reset, and billing columns to firms table
-- Run after ksef-schema-migration.sql

ALTER TABLE firms ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE firms ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64);
ALTER TABLE firms ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE firms ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
ALTER TABLE firms ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30) DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'past_due', 'canceled', 'paused'));
