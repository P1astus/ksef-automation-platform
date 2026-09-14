-- KSeF Stress Test - Phase 2: Insert ~10,000 Synthetic Invoices
-- Run AFTER stress-test-clients.sql
-- Run: docker exec -i ksef_db psql -U ksef_app -d ksef_platform < stress-test-invoices.sql

BEGIN;

-- ============================================================================
-- Helper: Create a temp table with client tiers to control volume per client
-- ============================================================================
CREATE TEMP TABLE client_tiers AS
SELECT c.nip, c.firm_id, c.client_name, c.monthly_invoice_volume,
    CASE
        WHEN c.monthly_invoice_volume >= 300 THEN 'high'
        WHEN c.monthly_invoice_volume >= 80  THEN 'medium'
        ELSE 'low'
    END AS tier
FROM clients c
WHERE c.sync_enabled = true AND c.nip != '1111111111';

-- ============================================================================
-- SALES INVOICES — high-volume clients: ~100 per month x 5 months = 500 each
-- ============================================================================
INSERT INTO invoices (
    firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction,
    seller_nip, seller_name, buyer_nip, buyer_name,
    net_amount, vat_amount, gross_amount, currency,
    issue_date, delivery_date,
    ksef_acquisition_date, ksef_permanent_storage_date,
    processing_status, jpk_marker, jpk_period
)
SELECT
    ct.firm_id,
    ct.nip,
    'ST' || ct.nip || 'S' || LPAD(s::text, 6, '0'),
    'FVS/' || ct.nip || '/' || TO_CHAR(base_date, 'YYYY') || '/' || LPAD(s::text, 5, '0'),
    CASE WHEN s % 30 = 0 THEN 'KOR' ELSE 'VAT' END,
    'sales',
    ct.nip,
    ct.client_name,
    -- Rotate buyer NIPs among other clients
    (ARRAY['2043321812','7001338905','9386379401','3654235114','7155940782',
           '2618495934','2034131644','8525534194','3832764838','6030564130'])[1 + (s % 10)],
    'Kontrahent ' || (s % 50 + 1),
    -- Amounts: net between 100 and 10000
    ROUND((100 + (s * 37 + ASCII(LEFT(ct.nip, 1)) * 13) % 9900)::numeric, 2),
    ROUND(((100 + (s * 37 + ASCII(LEFT(ct.nip, 1)) * 13) % 9900) * 0.23)::numeric, 2),
    ROUND(((100 + (s * 37 + ASCII(LEFT(ct.nip, 1)) * 13) % 9900) * 1.23)::numeric, 2),
    'PLN',
    base_date,
    base_date + INTERVAL '3 days',
    base_date::timestamptz + INTERVAL '2 hours',
    base_date::timestamptz + INTERVAL '4 hours',
    CASE WHEN s % 25 = 0 THEN 'error' WHEN s % 15 = 0 THEN 'classified' ELSE 'new' END,
    -- JPK markers: ~80% NrKSeF, ~10% OFF, ~5% BFK, ~5% DI
    CASE
        WHEN s % 20 = 0 THEN 'DI'
        WHEN s % 20 = 1 THEN 'BFK'
        WHEN s % 20 IN (2, 3) THEN 'OFF'
        ELSE 'NrKSeF'
    END,
    TO_CHAR(base_date, 'YYYY-MM')
FROM client_tiers ct
CROSS JOIN LATERAL (
    SELECT s, DATE '2025-10-01' + ((s - 1) % 150 * INTERVAL '1 day') AS base_date
    FROM generate_series(1, 500) AS s
) inv
WHERE ct.tier = 'high'
ON CONFLICT (ksef_number) DO NOTHING;

-- ============================================================================
-- PURCHASE INVOICES — high-volume clients: ~100 per month x 5 months = 500 each
-- ============================================================================
INSERT INTO invoices (
    firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction,
    seller_nip, seller_name, buyer_nip, buyer_name,
    net_amount, vat_amount, gross_amount, currency,
    issue_date, delivery_date,
    ksef_acquisition_date, ksef_permanent_storage_date,
    processing_status, jpk_marker, jpk_period
)
SELECT
    ct.firm_id,
    ct.nip,
    'ST' || ct.nip || 'P' || LPAD(s::text, 6, '0'),
    'FVP/' || ct.nip || '/' || TO_CHAR(base_date, 'YYYY') || '/' || LPAD(s::text, 5, '0'),
    'VAT',
    'purchase',
    (ARRAY['2043321812','7001338905','9386379401','3654235114','7155940782',
           '2618495934','2034131644','8525534194','3832764838','6030564130'])[1 + (s % 10)],
    'Dostawca ' || (s % 40 + 1),
    ct.nip,
    ct.client_name,
    ROUND((50 + (s * 41 + ASCII(LEFT(ct.nip, 1)) * 7) % 5000)::numeric, 2),
    ROUND(((50 + (s * 41 + ASCII(LEFT(ct.nip, 1)) * 7) % 5000) * 0.23)::numeric, 2),
    ROUND(((50 + (s * 41 + ASCII(LEFT(ct.nip, 1)) * 7) % 5000) * 1.23)::numeric, 2),
    'PLN',
    base_date,
    base_date + INTERVAL '5 days',
    base_date::timestamptz + INTERVAL '3 hours',
    base_date::timestamptz + INTERVAL '6 hours',
    CASE WHEN s % 25 = 0 THEN 'error' ELSE 'new' END,
    CASE
        WHEN s % 20 = 0 THEN 'DI'
        WHEN s % 20 = 1 THEN 'BFK'
        WHEN s % 20 IN (2, 3) THEN 'OFF'
        ELSE 'NrKSeF'
    END,
    TO_CHAR(base_date, 'YYYY-MM')
FROM client_tiers ct
CROSS JOIN LATERAL (
    SELECT s, DATE '2025-10-01' + ((s - 1) % 150 * INTERVAL '1 day') AS base_date
    FROM generate_series(1, 500) AS s
) inv
WHERE ct.tier = 'high'
ON CONFLICT (ksef_number) DO NOTHING;

-- ============================================================================
-- SALES INVOICES — medium-volume clients: ~40 per month x 5 months = 200 each
-- ============================================================================
INSERT INTO invoices (
    firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction,
    seller_nip, seller_name, buyer_nip, buyer_name,
    net_amount, vat_amount, gross_amount, currency,
    issue_date, delivery_date,
    ksef_acquisition_date, ksef_permanent_storage_date,
    processing_status, jpk_marker, jpk_period
)
SELECT
    ct.firm_id,
    ct.nip,
    'ST' || ct.nip || 'S' || LPAD(s::text, 6, '0'),
    'FVS/' || ct.nip || '/' || TO_CHAR(base_date, 'YYYY') || '/' || LPAD(s::text, 5, '0'),
    CASE WHEN s % 20 = 0 THEN 'KOR' ELSE 'VAT' END,
    'sales',
    ct.nip,
    ct.client_name,
    (ARRAY['3489638348','6098393016','1310518341','8382997372','1106513338',
           '8810801322','7773602609','7474687236','5309805002','8882081216'])[1 + (s % 10)],
    'Odbiorca ' || (s % 30 + 1),
    ROUND((200 + (s * 29 + ASCII(LEFT(ct.nip, 1)) * 11) % 8000)::numeric, 2),
    ROUND(((200 + (s * 29 + ASCII(LEFT(ct.nip, 1)) * 11) % 8000) * 0.23)::numeric, 2),
    ROUND(((200 + (s * 29 + ASCII(LEFT(ct.nip, 1)) * 11) % 8000) * 1.23)::numeric, 2),
    'PLN',
    base_date,
    base_date + INTERVAL '3 days',
    base_date::timestamptz + INTERVAL '1 hour',
    base_date::timestamptz + INTERVAL '3 hours',
    CASE WHEN s % 30 = 0 THEN 'error' ELSE 'new' END,
    CASE
        WHEN s % 20 = 0 THEN 'DI'
        WHEN s % 20 = 1 THEN 'BFK'
        WHEN s % 20 IN (2, 3) THEN 'OFF'
        ELSE 'NrKSeF'
    END,
    TO_CHAR(base_date, 'YYYY-MM')
FROM client_tiers ct
CROSS JOIN LATERAL (
    SELECT s, DATE '2025-10-01' + ((s - 1) % 150 * INTERVAL '1 day') AS base_date
    FROM generate_series(1, 200) AS s
) inv
WHERE ct.tier = 'medium'
ON CONFLICT (ksef_number) DO NOTHING;

-- ============================================================================
-- PURCHASE INVOICES — medium-volume clients: ~40 per month x 5 months = 200 each
-- ============================================================================
INSERT INTO invoices (
    firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction,
    seller_nip, seller_name, buyer_nip, buyer_name,
    net_amount, vat_amount, gross_amount, currency,
    issue_date, delivery_date,
    ksef_acquisition_date, ksef_permanent_storage_date,
    processing_status, jpk_marker, jpk_period
)
SELECT
    ct.firm_id,
    ct.nip,
    'ST' || ct.nip || 'P' || LPAD(s::text, 6, '0'),
    'FVP/' || ct.nip || '/' || TO_CHAR(base_date, 'YYYY') || '/' || LPAD(s::text, 5, '0'),
    'VAT',
    'purchase',
    (ARRAY['3489638348','6098393016','1310518341','8382997372','1106513338',
           '8810801322','7773602609','7474687236','5309805002','8882081216'])[1 + (s % 10)],
    'Dostawca ' || (s % 30 + 1),
    ct.nip,
    ct.client_name,
    ROUND((80 + (s * 31 + ASCII(LEFT(ct.nip, 1)) * 9) % 4000)::numeric, 2),
    ROUND(((80 + (s * 31 + ASCII(LEFT(ct.nip, 1)) * 9) % 4000) * 0.23)::numeric, 2),
    ROUND(((80 + (s * 31 + ASCII(LEFT(ct.nip, 1)) * 9) % 4000) * 1.23)::numeric, 2),
    'PLN',
    base_date,
    base_date + INTERVAL '7 days',
    base_date::timestamptz + INTERVAL '2 hours',
    base_date::timestamptz + INTERVAL '5 hours',
    CASE WHEN s % 30 = 0 THEN 'error' ELSE 'new' END,
    CASE
        WHEN s % 20 = 0 THEN 'DI'
        WHEN s % 20 = 1 THEN 'BFK'
        WHEN s % 20 IN (2, 3) THEN 'OFF'
        ELSE 'NrKSeF'
    END,
    TO_CHAR(base_date, 'YYYY-MM')
FROM client_tiers ct
CROSS JOIN LATERAL (
    SELECT s, DATE '2025-10-01' + ((s - 1) % 150 * INTERVAL '1 day') AS base_date
    FROM generate_series(1, 200) AS s
) inv
WHERE ct.tier = 'medium'
ON CONFLICT (ksef_number) DO NOTHING;

-- ============================================================================
-- SALES + PURCHASE — low-volume clients: ~10 per month x 5 months = 50 each direction
-- ============================================================================
INSERT INTO invoices (
    firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction,
    seller_nip, seller_name, buyer_nip, buyer_name,
    net_amount, vat_amount, gross_amount, currency,
    issue_date, delivery_date,
    ksef_acquisition_date, ksef_permanent_storage_date,
    processing_status, jpk_marker, jpk_period
)
SELECT
    ct.firm_id,
    ct.nip,
    'ST' || ct.nip || dir.code || LPAD(s::text, 6, '0'),
    'FV' || dir.code || '/' || ct.nip || '/' || TO_CHAR(base_date, 'YYYY') || '/' || LPAD(s::text, 4, '0'),
    'VAT',
    dir.direction,
    CASE WHEN dir.direction = 'sales' THEN ct.nip ELSE '2043321812' END,
    CASE WHEN dir.direction = 'sales' THEN ct.client_name ELSE 'Dostawca Hurtowy' END,
    CASE WHEN dir.direction = 'purchase' THEN ct.nip ELSE '7001338905' END,
    CASE WHEN dir.direction = 'purchase' THEN ct.client_name ELSE 'Odbiorca Detaliczny' END,
    ROUND((50 + (s * 23) % 3000)::numeric, 2),
    ROUND(((50 + (s * 23) % 3000) * 0.23)::numeric, 2),
    ROUND(((50 + (s * 23) % 3000) * 1.23)::numeric, 2),
    'PLN',
    base_date,
    base_date + INTERVAL '2 days',
    base_date::timestamptz + INTERVAL '1 hour',
    base_date::timestamptz + INTERVAL '2 hours',
    'new',
    CASE WHEN s % 20 = 0 THEN 'DI' WHEN s % 20 = 1 THEN 'BFK' WHEN s % 10 = 2 THEN 'OFF' ELSE 'NrKSeF' END,
    TO_CHAR(base_date, 'YYYY-MM')
FROM client_tiers ct
CROSS JOIN (VALUES ('S', 'sales'), ('P', 'purchase')) AS dir(code, direction)
CROSS JOIN LATERAL (
    SELECT s, DATE '2025-10-01' + ((s - 1) % 150 * INTERVAL '1 day') AS base_date
    FROM generate_series(1, 50) AS s
) inv
WHERE ct.tier = 'low'
ON CONFLICT (ksef_number) DO NOTHING;

-- ============================================================================
-- CERTIFICATE AUTH clients: ~30 per month x 5 months = 150 each direction
--
-- Round 4: found while actually running this file for the first time (never
-- exercised before) - this block always inserted 0 rows. All 4 certificate
-- clients have monthly_invoice_volume >= 80, so they're already classified
-- 'medium' by client_tiers above and got 400 invoices each from the
-- MEDIUM-VOLUME block, using the exact same ksef_number pattern
-- ('ST' || nip || dir.code || LPAD(s, 6, '0')) for the same s range (1-150
-- is a subset of that block's 1-200) - every row here collided with one
-- already inserted there and ON CONFLICT (ksef_number) DO NOTHING silently
-- ate all of them. Given a distinct prefix ('STC') so this block adds its
-- own invoices instead of colliding with ones that already exist.
-- ============================================================================
INSERT INTO invoices (
    firm_id, client_nip, ksef_number, invoice_number, invoice_type, direction,
    seller_nip, seller_name, buyer_nip, buyer_name,
    net_amount, vat_amount, gross_amount, currency,
    issue_date, delivery_date,
    ksef_acquisition_date, ksef_permanent_storage_date,
    processing_status, jpk_marker, jpk_period
)
SELECT
    ct.firm_id,
    ct.nip,
    'STC' || ct.nip || dir.code || LPAD(s::text, 6, '0'),
    'FVC' || dir.code || '/' || ct.nip || '/' || TO_CHAR(base_date, 'YYYY') || '/' || LPAD(s::text, 5, '0'),
    CASE WHEN s % 25 = 0 THEN 'KOR' ELSE 'VAT' END,
    dir.direction,
    CASE WHEN dir.direction = 'sales' THEN ct.nip ELSE '3654235114' END,
    CASE WHEN dir.direction = 'sales' THEN ct.client_name ELSE 'Dostawca Cert' END,
    CASE WHEN dir.direction = 'purchase' THEN ct.nip ELSE '7155940782' END,
    CASE WHEN dir.direction = 'purchase' THEN ct.client_name ELSE 'Odbiorca Cert' END,
    ROUND((500 + (s * 53) % 15000)::numeric, 2),
    ROUND(((500 + (s * 53) % 15000) * 0.23)::numeric, 2),
    ROUND(((500 + (s * 53) % 15000) * 1.23)::numeric, 2),
    'PLN',
    base_date,
    base_date + INTERVAL '4 days',
    base_date::timestamptz + INTERVAL '2 hours',
    base_date::timestamptz + INTERVAL '5 hours',
    CASE WHEN s % 20 = 0 THEN 'error' ELSE 'new' END,
    CASE
        WHEN s % 20 = 0 THEN 'DI'
        WHEN s % 20 = 1 THEN 'BFK'
        WHEN s % 20 IN (2, 3) THEN 'OFF'
        ELSE 'NrKSeF'
    END,
    TO_CHAR(base_date, 'YYYY-MM')
FROM clients ct
CROSS JOIN (VALUES ('S', 'sales'), ('P', 'purchase')) AS dir(code, direction)
CROSS JOIN LATERAL (
    SELECT s, DATE '2025-10-01' + ((s - 1) % 150 * INTERVAL '1 day') AS base_date
    FROM generate_series(1, 150) AS s
) inv
WHERE ct.nip IN ('7773602609','7474687236','5309805002','8882081216')
ON CONFLICT (ksef_number) DO NOTHING;

COMMIT;

-- Drop temp table (auto-dropped at end of session, but be explicit)
DROP TABLE IF EXISTS client_tiers;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Total invoice count
SELECT COUNT(*) AS total_invoices FROM invoices;

-- Per-tier breakdown
SELECT
    CASE
        WHEN c.monthly_invoice_volume >= 300 THEN 'high'
        WHEN c.monthly_invoice_volume >= 80  THEN 'medium'
        ELSE 'low'
    END AS tier,
    i.direction,
    COUNT(*) AS invoice_count
FROM invoices i
JOIN clients c ON i.firm_id = c.firm_id AND i.client_nip = c.nip
WHERE i.ksef_number LIKE 'ST%'
GROUP BY 1, 2
ORDER BY 1, 2;

-- Per-period breakdown
SELECT jpk_period, direction, COUNT(*) AS cnt
FROM invoices
WHERE ksef_number LIKE 'ST%'
GROUP BY jpk_period, direction
ORDER BY jpk_period, direction;

-- JPK marker distribution
SELECT jpk_marker, COUNT(*) AS cnt,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct
FROM invoices
WHERE ksef_number LIKE 'ST%'
GROUP BY jpk_marker
ORDER BY cnt DESC;

-- Offline invoice distribution now lives in offline_invoices, not invoices
-- (see migrations/2026-09-13-offline-invoice-linking.sql / stress-test-offline.sql).
SELECT offline_mode, COUNT(*)
FROM offline_invoices
GROUP BY offline_mode;
