-- Round 17 (part 2): the remaining optional JPK_V7M(3) inputs.
--  * clients.taxpayer_type/first_name/last_name/birth_date: Podmiot1 for a sole
--    trader is OsobaFizyczna (NIP + first name + surname + date of birth), not
--    OsobaNiefizyczna. Default 'company' keeps every existing client as it was.
--  * invoices.jpk_counterparty_country: KodKrajuNadaniaTIN, the country that
--    issued a foreign contractor's tax number (empty for Polish contractors).
--  * invoices.jpk_margin_gross: SprzedazVAT_Marza (sales, MR_T/MR_UZ rows) or
--    ZakupVAT_Marza (purchases): the gross value under the margin scheme.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS taxpayer_type TEXT NOT NULL DEFAULT 'company';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_taxpayer_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_taxpayer_type_check
    CHECK (taxpayer_type IN ('company', 'individual'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_counterparty_country TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_margin_gross NUMERIC(14,2);
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_jpk_counterparty_country_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_jpk_counterparty_country_check
    CHECK (jpk_counterparty_country IS NULL OR jpk_counterparty_country ~ '^[A-Z]{2}$');

-- Foreign (EU) VAT numbers are longer than a 10-digit NIP (e.g. DE123456789,
-- FR12345678901); the register's KodKrajuNadaniaTIN/NrKontrahenta pair needs
-- to be able to store them. Widening is safe and idempotent.
ALTER TABLE invoices ALTER COLUMN buyer_nip TYPE VARCHAR(20);
ALTER TABLE invoices ALTER COLUMN seller_nip TYPE VARCHAR(20);
