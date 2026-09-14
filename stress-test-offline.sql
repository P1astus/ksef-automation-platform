-- KSeF Stress Test - Phase 3: Insert Offline Invoices at All Urgency Tiers
-- Run AFTER stress-test-clients.sql
-- Run: docker exec -i ksef_db psql -U ksef_app -d ksef_platform < stress-test-offline.sql

-- Clean existing synthetic offline invoices (preserve NIP 1111111111)
DELETE FROM offline_invoices WHERE client_nip != '1111111111';

BEGIN;

-- ============================================================================
-- Insert offline invoices across multiple clients and urgency tiers
-- Tiers tested by Offline24 Monitor's "Calculate Time Remaining" + "Route by Urgency":
--   OVERDUE:  deadline passed
--   CRITICAL: deadline < 1 hour
--   WARNING:  deadline < 4 hours
--   SAFE:     deadline > 4 hours
--   UPLOADED: already uploaded (should be skipped by query)
-- ============================================================================

-- Use a CTE to get the first 10 sync-enabled synthetic clients
WITH target_clients AS (
    SELECT nip, firm_id, client_name, ROW_NUMBER() OVER (ORDER BY nip) as rn
    FROM clients
    WHERE sync_enabled = true AND nip != '1111111111'
    LIMIT 10
)
INSERT INTO offline_invoices (
    firm_id, client_nip, invoice_number, offline_mode,
    issue_timestamp, upload_deadline,
    uploaded_to_ksef, ksef_number, upload_attempts, last_attempt_error,
    alert_sent_4h, alert_sent_1h, alert_sent_overdue
)
SELECT * FROM (
    -- === OVERDUE invoices (deadline 1-6 hours ago, not yet alerted as overdue) ===
    SELECT
        tc.firm_id,
        tc.nip,
        'OFF/' || tc.nip || '/OVR/' || LPAD(g::text, 3, '0'),
        'offline24',
        NOW() - INTERVAL '26 hours' - (g * INTERVAL '1 hour'),
        NOW() - INTERVAL '2 hours' - (g * INTERVAL '1 hour'),
        false, NULL,
        2 + g, -- multiple failed upload attempts
        'KSeF API returned 503 during upload window',
        true, true, false  -- 4h and 1h alerts sent, but NOT overdue alert
    FROM target_clients tc
    CROSS JOIN generate_series(0, 2) AS g
    WHERE tc.rn <= 5  -- 5 clients x 3 overdue each = 15

    UNION ALL

    -- === CRITICAL invoices (deadline in 15-55 minutes) ===
    SELECT
        tc.firm_id,
        tc.nip,
        'OFF/' || tc.nip || '/CRT/' || LPAD(g::text, 3, '0'),
        'offline24',
        NOW() - INTERVAL '23 hours' - (g * INTERVAL '10 minutes'),
        NOW() + (15 + g * 10) * INTERVAL '1 minute',
        false, NULL,
        1, NULL,
        true, false, false  -- only 4h alert sent
    FROM target_clients tc
    CROSS JOIN generate_series(0, 1) AS g
    WHERE tc.rn BETWEEN 1 AND 8  -- 8 clients x 2 critical each = 16

    UNION ALL

    -- === WARNING invoices (deadline in 1-3.5 hours) ===
    SELECT
        tc.firm_id,
        tc.nip,
        'OFF/' || tc.nip || '/WRN/' || LPAD(g::text, 3, '0'),
        'unavailability',
        NOW() - INTERVAL '21 hours' - (g * INTERVAL '30 minutes'),
        NOW() + (60 + g * 45) * INTERVAL '1 minute',
        false, NULL,
        0, NULL,
        false, false, false  -- no alerts sent yet
    FROM target_clients tc
    CROSS JOIN generate_series(0, 1) AS g
    WHERE tc.rn BETWEEN 3 AND 10  -- 8 clients x 2 warning each = 16

    UNION ALL

    -- === SAFE invoices (deadline 8-24 hours from now) ===
    SELECT
        tc.firm_id,
        tc.nip,
        'OFF/' || tc.nip || '/SAFE/' || LPAD(g::text, 3, '0'),
        'offline24',
        NOW() - INTERVAL '10 hours' + (g * INTERVAL '2 hours'),
        NOW() + (8 + g * 4) * INTERVAL '1 hour',
        false, NULL,
        0, NULL,
        false, false, false
    FROM target_clients tc
    CROSS JOIN generate_series(0, 1) AS g
    WHERE tc.rn <= 6  -- 6 clients x 2 safe each = 12

    UNION ALL

    -- === ALREADY UPLOADED (should be filtered out by the workflow's WHERE uploaded_to_ksef = false) ===
    SELECT
        tc.firm_id,
        tc.nip,
        'OFF/' || tc.nip || '/DONE/' || LPAD(g::text, 3, '0'),
        'emergency',
        NOW() - INTERVAL '48 hours',
        NOW() - INTERVAL '24 hours',
        true,
        'KSEF-STRESS-DONE-' || tc.nip || '-' || g,
        1, NULL,
        true, true, true  -- all alerts were sent before successful upload
    FROM target_clients tc
    CROSS JOIN generate_series(0, 0) AS g
    WHERE tc.rn <= 10  -- 10 clients x 1 done each = 10
) combined;

COMMIT;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Total count
SELECT COUNT(*) AS total_offline FROM offline_invoices WHERE client_nip != '1111111111';

-- Urgency distribution (mimics the workflow's logic)
SELECT
    CASE
        WHEN uploaded_to_ksef = true THEN 'UPLOADED'
        WHEN upload_deadline < NOW() THEN 'OVERDUE'
        WHEN upload_deadline < NOW() + INTERVAL '1 hour' THEN 'CRITICAL'
        WHEN upload_deadline < NOW() + INTERVAL '4 hours' THEN 'WARNING'
        ELSE 'SAFE'
    END AS urgency,
    COUNT(*) AS cnt,
    SUM(CASE WHEN alert_sent_overdue THEN 1 ELSE 0 END) AS alerted_overdue,
    SUM(CASE WHEN alert_sent_1h THEN 1 ELSE 0 END) AS alerted_1h,
    SUM(CASE WHEN alert_sent_4h THEN 1 ELSE 0 END) AS alerted_4h
FROM offline_invoices
WHERE client_nip != '1111111111'
GROUP BY 1
ORDER BY 1;

-- Pending (what the workflow will actually query)
SELECT COUNT(*) AS pending_for_workflow
FROM offline_invoices
WHERE uploaded_to_ksef = false;
