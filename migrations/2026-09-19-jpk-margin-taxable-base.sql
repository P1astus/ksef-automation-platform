-- VAT-marża: jpk_margin_gross remains the buyer's full amount due and is
-- emitted as SprzedazVAT_Marza.  The taxable, VAT-inclusive margin is a
-- distinct internal input; it must never be used in a buyer invoice/PDF.
-- The rate and method make the JPK calculation auditable and avoid guessing.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_margin_taxable_gross NUMERIC(14,2);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_margin_vat_rate TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_margin_method TEXT;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_jpk_margin_vat_rate_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_jpk_margin_vat_rate_check
    CHECK (jpk_margin_vat_rate IS NULL OR jpk_margin_vat_rate IN ('5', '8', '23'));
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_jpk_margin_method_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_jpk_margin_method_check
    CHECK (jpk_margin_method IS NULL OR jpk_margin_method IN ('individual', 'sum'));
