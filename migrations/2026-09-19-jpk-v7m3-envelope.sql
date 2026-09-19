-- Round 17: fields the JPK_V7M(3) v1-0E structure requires that the platform
-- never stored (schemas/jpk-v7m3/JPK_V7M3_v1-0E.xsd).
--  * clients.tax_office_code: Naglowek/KodUrzedu, the urzad skarbowy the
--    declaration is filed with (4 digits, validated against the official list
--    in portal/src/lib/tax-office-codes.ts). No default - a wrong office is
--    worse than a refused generation.
--  * invoices.jpk_doc_type: optional TypDokumentu (sales: RO/WEW/FP) or
--    DokumentZakupu (purchases: MK/VAT_RR/WEW). Which set applies is checked
--    by the application per direction (portal/src/lib/jpk-markers.ts).
--  * invoices.jpk_import: purchase-side IMP flag (import of goods).

ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_office_code TEXT;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tax_office_code_check;
ALTER TABLE clients ADD CONSTRAINT clients_tax_office_code_check
    CHECK (tax_office_code IS NULL OR tax_office_code ~ '^[0-9]{4}$');

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_doc_type TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS jpk_import BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_jpk_doc_type_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_jpk_doc_type_check
    CHECK (jpk_doc_type IS NULL OR jpk_doc_type IN ('RO','WEW','FP','MK','VAT_RR'));
