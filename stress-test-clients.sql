-- KSeF Stress Test - Phase 1: Insert 30 Synthetic Clients
-- Run: docker exec -i ksef_db psql -U ksef_app -d ksef_platform < stress-test-clients.sql
--
-- Round 4: these fixtures predate the multi-tenancy migration (clients/
-- invoices/offline_invoices all gained a firm_id column, NOT NULL on the
-- latter two) and never carried a firm_id - confirmed by actually running
-- them: stress-test-invoices.sql and stress-test-offline.sql both failed
-- outright with "null value in column firm_id violates not-null constraint"
-- (stress-test-clients.sql alone "succeeded" only because clients.firm_id
-- happens to be nullable, silently producing 30 clients belonging to no
-- firm). Fixed by creating one dedicated stress-test firm here and carrying
-- its id through all three files instead.

-- Idempotent: reuses the same firm across repeated runs instead of
-- accumulating one per run.
INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, subscription_tier, max_clients, onboarding_complete)
VALUES ('Stress Test Firm', 'stress-test-firm', 'stress-test-firm@test.ksef.local', 'not-a-real-hash-this-firm-cannot-log-in', 'pro', 999, true)
ON CONFLICT (slug) DO UPDATE SET updated_at = now()
RETURNING id AS stress_firm_id \gset

BEGIN;

-- Clean previous synthetic data (preserve real test client NIP 1111111111)
DELETE FROM audit_log WHERE client_nip != '1111111111';
DELETE FROM jpk_preparations WHERE client_nip != '1111111111';
DELETE FROM offline_invoices WHERE client_nip != '1111111111';
DELETE FROM invoices WHERE client_nip != '1111111111';
DELETE FROM clients WHERE nip != '1111111111';

-- All NIPs are checksum-valid (weights [6,5,7,2,3,4,5,6,7], sum%11 = last digit)
INSERT INTO clients (
    firm_id, client_name, nip, auth_method, ksef_token_encrypted,
    permission_level, sync_enabled, contact_email, contact_phone,
    monthly_invoice_volume, preferred_session_mode
) VALUES
-- === HIGH-VOLUME TOKEN CLIENTS (8) — 300-500 invoices/month ===
(:stress_firm_id, 'Biuro Rachunkowe Alpha Sp. z o.o.',    '2043321812', 'token', 'FAKE_STRESS_TOKEN_01', 'read_write', true,  'stress-test@test.ksef.local', '+48221000001', 450, 'interactive'),
(:stress_firm_id, 'Kancelaria Podatkowa Beta S.A.',       '7001338905', 'token', 'FAKE_STRESS_TOKEN_02', 'read_write', true,  'stress-test@test.ksef.local', '+48221000002', 420, 'interactive'),
(:stress_firm_id, 'Doradztwo Finansowe Gamma Sp. z o.o.', '9386379401', 'token', 'FAKE_STRESS_TOKEN_03', 'read_write', true,  'stress-test@test.ksef.local', '+48221000003', 380, 'interactive'),
(:stress_firm_id, 'Rachunkowosc Delta Sp. z o.o.',        '3654235114', 'token', 'FAKE_STRESS_TOKEN_04', 'read_write', true,  'stress-test@test.ksef.local', '+48221000004', 500, 'interactive'),
(:stress_firm_id, 'FK Epsilon Sp. z o.o.',                '7155940782', 'token', 'FAKE_STRESS_TOKEN_05', 'read_write', true,  'stress-test@test.ksef.local', '+48221000005', 350, 'interactive'),
(:stress_firm_id, 'Biuro FK Zeta S.A.',                   '2618495934', 'token', 'FAKE_STRESS_TOKEN_06', 'read_write', true,  'stress-test@test.ksef.local', '+48221000006', 480, 'interactive'),
(:stress_firm_id, 'Konsulting Eta Sp. z o.o.',            '2034131644', 'token', 'FAKE_STRESS_TOKEN_07', 'read_write', true,  'stress-test@test.ksef.local', '+48221000007', 310, 'interactive'),
(:stress_firm_id, 'Rachunkowosc Theta Sp. z o.o.',        '8525534194', 'token', 'FAKE_STRESS_TOKEN_08', 'read_write', true,  'stress-test@test.ksef.local', '+48221000008', 400, 'interactive'),

-- === MEDIUM-VOLUME TOKEN CLIENTS (10) — 80-200 invoices/month ===
(:stress_firm_id, 'Transport Iota Sp. z o.o.',            '3832764838', 'token', 'FAKE_STRESS_TOKEN_09', 'read_write', true,  'stress-test@test.ksef.local', '+48221000009', 180, 'interactive'),
(:stress_firm_id, 'Handel Kappa Sp. z o.o.',              '6030564130', 'token', 'FAKE_STRESS_TOKEN_10', 'read_write', true,  'stress-test@test.ksef.local', '+48221000010', 150, 'interactive'),
(:stress_firm_id, 'Uslugi Lambda Sp. z o.o.',             '6376724237', 'token', 'FAKE_STRESS_TOKEN_11', 'read_write', true,  'stress-test@test.ksef.local', '+48221000011', 200, 'interactive'),
(:stress_firm_id, 'Produkcja Mu Sp. z o.o.',              '9849696530', 'token', 'FAKE_STRESS_TOKEN_12', 'read_write', true,  'stress-test@test.ksef.local', '+48221000012', 120, 'interactive'),
(:stress_firm_id, 'Budownictwo Nu S.A.',                  '3871012261', 'token', 'FAKE_STRESS_TOKEN_13', 'read_write', true,  'stress-test@test.ksef.local', '+48221000013', 100, 'interactive'),
(:stress_firm_id, 'Gastronomia Xi Sp. z o.o.',            '2669784803', 'token', 'FAKE_STRESS_TOKEN_14', 'read_write', true,  'stress-test@test.ksef.local', '+48221000014',  90, 'interactive'),
(:stress_firm_id, 'IT Omicron Sp. z o.o.',                '2845146272', 'token', 'FAKE_STRESS_TOKEN_15', 'read_write', true,  'stress-test@test.ksef.local', '+48221000015', 160, 'interactive'),
(:stress_firm_id, 'Logistyka Pi Sp. z o.o.',              '1482814893', 'token', 'FAKE_STRESS_TOKEN_16', 'read_write', true,  'stress-test@test.ksef.local', '+48221000016', 140, 'interactive'),
(:stress_firm_id, 'Edukacja Rho Sp. z o.o.',              '4252880959', 'token', 'FAKE_STRESS_TOKEN_17', 'read_write', true,  'stress-test@test.ksef.local', '+48221000017',  80, 'interactive'),
(:stress_firm_id, 'Medycyna Sigma Sp. z o.o.',            '8015430395', 'token', 'FAKE_STRESS_TOKEN_18', 'read_write', true,  'stress-test@test.ksef.local', '+48221000018', 110, 'interactive'),

-- === LOW-VOLUME TOKEN CLIENTS (6) — 10-50 invoices/month, batch mode ===
(:stress_firm_id, 'Fotografia Tau',                       '3489638348', 'token', 'FAKE_STRESS_TOKEN_19', 'read_write', true,  'stress-test@test.ksef.local', '+48221000019',  30, 'batch'),
(:stress_firm_id, 'Reklama Upsilon',                      '6098393016', 'token', 'FAKE_STRESS_TOKEN_20', 'read_write', true,  'stress-test@test.ksef.local', '+48221000020',  20, 'batch'),
(:stress_firm_id, 'Doradztwo Phi',                        '1310518341', 'token', 'FAKE_STRESS_TOKEN_21', 'read_write', true,  'stress-test@test.ksef.local', '+48221000021',  45, 'batch'),
(:stress_firm_id, 'Nieruchomosci Chi',                    '8382997372', 'token', 'FAKE_STRESS_TOKEN_22', 'read_write', true,  'stress-test@test.ksef.local', '+48221000022',  15, 'batch'),
(:stress_firm_id, 'Turystyka Psi',                        '1106513338', 'token', 'FAKE_STRESS_TOKEN_23', 'read_write', true,  'stress-test@test.ksef.local', '+48221000023',  50, 'batch'),
(:stress_firm_id, 'Ogrodnictwo Omega',                    '8810801322', 'token', 'FAKE_STRESS_TOKEN_24', 'read_write', true,  'stress-test@test.ksef.local', '+48221000024',  10, 'batch'),

-- === CERTIFICATE AUTH CLIENTS (4) — 100-250 invoices/month ===
(:stress_firm_id, 'Korporacja Alfa-Cert S.A.',            '7773602609', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000025', 250, 'interactive'),
(:stress_firm_id, 'Holding Beta-Cert Sp. z o.o.',         '7474687236', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000026', 200, 'interactive'),
(:stress_firm_id, 'Grupa Gamma-Cert S.A.',                '5309805002', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000027', 150, 'interactive'),
(:stress_firm_id, 'Fundacja Delta-Cert',                  '8882081216', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000028', 100, 'interactive'),

-- === SYNC-DISABLED CLIENTS (2) — should be skipped by Invoice Retrieval ===
(:stress_firm_id, 'Klient Wstrzymany Sp. z o.o.',         '2361939900', 'token', 'FAKE_STRESS_TOKEN_29', 'read_write', false, 'stress-test@test.ksef.local', '+48221000029',  80, 'interactive'),
(:stress_firm_id, 'Klient Archiwum Sp. z o.o.',           '2699854359', 'token', 'FAKE_STRESS_TOKEN_30', 'read_write', false, 'stress-test@test.ksef.local', '+48221000030',  30, 'batch');

COMMIT;

-- Verify
SELECT auth_method, sync_enabled, preferred_session_mode, COUNT(*) as cnt,
       SUM(monthly_invoice_volume) as total_volume
FROM clients
WHERE nip != '1111111111'
GROUP BY auth_method, sync_enabled, preferred_session_mode
ORDER BY auth_method, sync_enabled DESC;

SELECT COUNT(*) as total_clients FROM clients;
