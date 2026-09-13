-- KSeF Stress Test - Phase 1: Insert 30 Synthetic Clients
-- Run: docker exec -i ksef_db psql -U ksef_app -d ksef_platform < stress-test-clients.sql

BEGIN;

-- Clean previous synthetic data (preserve real test client NIP 1111111111)
DELETE FROM audit_log WHERE client_nip != '1111111111';
DELETE FROM jpk_preparations WHERE client_nip != '1111111111';
DELETE FROM offline_invoices WHERE client_nip != '1111111111';
DELETE FROM invoices WHERE client_nip != '1111111111';
DELETE FROM clients WHERE nip != '1111111111';

-- All NIPs are checksum-valid (weights [6,5,7,2,3,4,5,6,7], sum%11 = last digit)
INSERT INTO clients (
    client_name, nip, auth_method, ksef_token_encrypted,
    permission_level, sync_enabled, contact_email, contact_phone,
    monthly_invoice_volume, preferred_session_mode
) VALUES
-- === HIGH-VOLUME TOKEN CLIENTS (8) — 300-500 invoices/month ===
('Biuro Rachunkowe Alpha Sp. z o.o.',    '2043321812', 'token', 'FAKE_STRESS_TOKEN_01', 'read_write', true,  'stress-test@test.ksef.local', '+48221000001', 450, 'interactive'),
('Kancelaria Podatkowa Beta S.A.',       '7001338905', 'token', 'FAKE_STRESS_TOKEN_02', 'read_write', true,  'stress-test@test.ksef.local', '+48221000002', 420, 'interactive'),
('Doradztwo Finansowe Gamma Sp. z o.o.', '9386379401', 'token', 'FAKE_STRESS_TOKEN_03', 'read_write', true,  'stress-test@test.ksef.local', '+48221000003', 380, 'interactive'),
('Rachunkowosc Delta Sp. z o.o.',        '3654235114', 'token', 'FAKE_STRESS_TOKEN_04', 'read_write', true,  'stress-test@test.ksef.local', '+48221000004', 500, 'interactive'),
('FK Epsilon Sp. z o.o.',                '7155940782', 'token', 'FAKE_STRESS_TOKEN_05', 'read_write', true,  'stress-test@test.ksef.local', '+48221000005', 350, 'interactive'),
('Biuro FK Zeta S.A.',                   '2618495934', 'token', 'FAKE_STRESS_TOKEN_06', 'read_write', true,  'stress-test@test.ksef.local', '+48221000006', 480, 'interactive'),
('Konsulting Eta Sp. z o.o.',            '2034131644', 'token', 'FAKE_STRESS_TOKEN_07', 'read_write', true,  'stress-test@test.ksef.local', '+48221000007', 310, 'interactive'),
('Rachunkowosc Theta Sp. z o.o.',        '8525534194', 'token', 'FAKE_STRESS_TOKEN_08', 'read_write', true,  'stress-test@test.ksef.local', '+48221000008', 400, 'interactive'),

-- === MEDIUM-VOLUME TOKEN CLIENTS (10) — 80-200 invoices/month ===
('Transport Iota Sp. z o.o.',            '3832764838', 'token', 'FAKE_STRESS_TOKEN_09', 'read_write', true,  'stress-test@test.ksef.local', '+48221000009', 180, 'interactive'),
('Handel Kappa Sp. z o.o.',              '6030564130', 'token', 'FAKE_STRESS_TOKEN_10', 'read_write', true,  'stress-test@test.ksef.local', '+48221000010', 150, 'interactive'),
('Uslugi Lambda Sp. z o.o.',             '6376724237', 'token', 'FAKE_STRESS_TOKEN_11', 'read_write', true,  'stress-test@test.ksef.local', '+48221000011', 200, 'interactive'),
('Produkcja Mu Sp. z o.o.',              '9849696530', 'token', 'FAKE_STRESS_TOKEN_12', 'read_write', true,  'stress-test@test.ksef.local', '+48221000012', 120, 'interactive'),
('Budownictwo Nu S.A.',                  '3871012261', 'token', 'FAKE_STRESS_TOKEN_13', 'read_write', true,  'stress-test@test.ksef.local', '+48221000013', 100, 'interactive'),
('Gastronomia Xi Sp. z o.o.',            '2669784803', 'token', 'FAKE_STRESS_TOKEN_14', 'read_write', true,  'stress-test@test.ksef.local', '+48221000014',  90, 'interactive'),
('IT Omicron Sp. z o.o.',                '2845146272', 'token', 'FAKE_STRESS_TOKEN_15', 'read_write', true,  'stress-test@test.ksef.local', '+48221000015', 160, 'interactive'),
('Logistyka Pi Sp. z o.o.',              '1482814893', 'token', 'FAKE_STRESS_TOKEN_16', 'read_write', true,  'stress-test@test.ksef.local', '+48221000016', 140, 'interactive'),
('Edukacja Rho Sp. z o.o.',              '4252880959', 'token', 'FAKE_STRESS_TOKEN_17', 'read_write', true,  'stress-test@test.ksef.local', '+48221000017',  80, 'interactive'),
('Medycyna Sigma Sp. z o.o.',            '8015430395', 'token', 'FAKE_STRESS_TOKEN_18', 'read_write', true,  'stress-test@test.ksef.local', '+48221000018', 110, 'interactive'),

-- === LOW-VOLUME TOKEN CLIENTS (6) — 10-50 invoices/month, batch mode ===
('Fotografia Tau',                       '3489638348', 'token', 'FAKE_STRESS_TOKEN_19', 'read_write', true,  'stress-test@test.ksef.local', '+48221000019',  30, 'batch'),
('Reklama Upsilon',                      '6098393016', 'token', 'FAKE_STRESS_TOKEN_20', 'read_write', true,  'stress-test@test.ksef.local', '+48221000020',  20, 'batch'),
('Doradztwo Phi',                        '1310518341', 'token', 'FAKE_STRESS_TOKEN_21', 'read_write', true,  'stress-test@test.ksef.local', '+48221000021',  45, 'batch'),
('Nieruchomosci Chi',                    '8382997372', 'token', 'FAKE_STRESS_TOKEN_22', 'read_write', true,  'stress-test@test.ksef.local', '+48221000022',  15, 'batch'),
('Turystyka Psi',                        '1106513338', 'token', 'FAKE_STRESS_TOKEN_23', 'read_write', true,  'stress-test@test.ksef.local', '+48221000023',  50, 'batch'),
('Ogrodnictwo Omega',                    '8810801322', 'token', 'FAKE_STRESS_TOKEN_24', 'read_write', true,  'stress-test@test.ksef.local', '+48221000024',  10, 'batch'),

-- === CERTIFICATE AUTH CLIENTS (4) — 100-250 invoices/month ===
('Korporacja Alfa-Cert S.A.',            '7773602609', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000025', 250, 'interactive'),
('Holding Beta-Cert Sp. z o.o.',         '7474687236', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000026', 200, 'interactive'),
('Grupa Gamma-Cert S.A.',                '5309805002', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000027', 150, 'interactive'),
('Fundacja Delta-Cert',                  '8882081216', 'certificate', NULL, 'read_write', true,  'stress-test@test.ksef.local', '+48221000028', 100, 'interactive'),

-- === SYNC-DISABLED CLIENTS (2) — should be skipped by Invoice Retrieval ===
('Klient Wstrzymany Sp. z o.o.',         '2361939900', 'token', 'FAKE_STRESS_TOKEN_29', 'read_write', false, 'stress-test@test.ksef.local', '+48221000029',  80, 'interactive'),
('Klient Archiwum Sp. z o.o.',           '2699854359', 'token', 'FAKE_STRESS_TOKEN_30', 'read_write', false, 'stress-test@test.ksef.local', '+48221000030',  30, 'batch');

COMMIT;

-- Verify
SELECT auth_method, sync_enabled, preferred_session_mode, COUNT(*) as cnt,
       SUM(monthly_invoice_volume) as total_volume
FROM clients
WHERE nip != '1111111111'
GROUP BY auth_method, sync_enabled, preferred_session_mode
ORDER BY auth_method, sync_enabled DESC;

SELECT COUNT(*) as total_clients FROM clients;
