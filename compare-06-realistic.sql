-- Disposable workflow 06 comparison fixture. Load inside a test transaction and roll it back.
-- 0202/1402/1471 are valid tax-office codes from lib/tax-office-codes.ts.
INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, subscription_tier, max_clients, onboarding_complete)
VALUES ('Comparison Firm', 'codex-compare-06', 'compare-owner@example.invalid', 'disabled', 'pro', 20, true);

INSERT INTO clients (firm_id, client_name, nip, auth_method, contact_email, tax_office_code,
                     taxpayer_type, first_name, last_name, birth_date)
SELECT f.id, v.client_name, v.nip, 'token', 'comparison@example.invalid', v.tax_office_code,
       v.taxpayer_type, v.first_name, v.last_name, v.birth_date::date
FROM firms f CROSS JOIN (VALUES
  ('Alpha Sp. z o.o.', '2043321812', '0202', 'company', NULL, NULL, NULL),
  ('Jan Kowalski', '3654235114', '1402', 'individual', 'Jan', 'Kowalski', '1980-01-02'),
  ('Gamma Sp. z o.o.', '9386379401', '1471', 'company', NULL, NULL, NULL)
) AS v(client_name, nip, tax_office_code, taxpayer_type, first_name, last_name, birth_date)
WHERE f.slug = 'codex-compare-06';

INSERT INTO invoices (firm_id, client_nip, invoice_number, invoice_type, direction,
                      seller_nip, seller_name, buyer_nip, buyer_name,
                      net_amount, vat_amount, gross_amount, issue_date, delivery_date,
                      jpk_period, jpk_marker, ksef_number)
SELECT f.id, v.client_nip, v.invoice_number, 'VAT', v.direction,
       CASE WHEN v.direction='sales' THEN v.client_nip ELSE '3654235114' END,
       CASE WHEN v.direction='sales' THEN c.client_name ELSE 'Dostawca' END,
       CASE WHEN v.direction='purchase' THEN v.client_nip ELSE '7155940782' END,
       CASE WHEN v.direction='purchase' THEN c.client_name ELSE 'Nabywca' END,
       v.net_amount, v.vat_amount, v.net_amount + v.vat_amount,
       v.issue_date::date, v.issue_date::date, v.jpk_period, v.marker, v.ksef_number
FROM firms f JOIN (VALUES
  ('2043321812', 'A-NRK', 'sales', 100::numeric, 23::numeric, '2026-02-10', '2026-02', 'NrKSeF', '2043321812-20260210-ABCDEF-123456-7A'),
  ('2043321812', 'A-OFF', 'sales', 200::numeric, 46::numeric, '2026-02-11', '2026-02', 'OFF', NULL),
  ('3654235114', 'J-BFK', 'sales', 300::numeric, 69::numeric, '2026-02-12', '2026-02', 'BFK', NULL),
  ('3654235114', 'J-PURCHASE', 'purchase', 50::numeric, 11.5::numeric, '2026-02-13', '2026-02', 'NrKSeF', '3654235114-20260213-ABCDEF-123456-7A'),
  ('9386379401', 'G-DI', 'sales', 400::numeric, 92::numeric, '2026-02-14', '2026-02', 'DI', NULL),
  ('9386379401', 'G-OVERRIDE-IN', 'purchase', 80::numeric, 18.4::numeric, '2026-01-31', '2026-02', 'NrKSeF', '3654235114-20260131-ABCDEF-123456-7A'),
  ('9386379401', 'G-OVERRIDE-OUT', 'sales', 90::numeric, 20.7::numeric, '2026-02-15', '2026-01', 'OFF', NULL)
) AS v(client_nip, invoice_number, direction, net_amount, vat_amount, issue_date, jpk_period, marker, ksef_number)
ON true JOIN clients c ON c.firm_id=f.id AND c.nip=v.client_nip
WHERE f.slug='codex-compare-06';
