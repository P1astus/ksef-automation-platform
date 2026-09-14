-- Correction invoices (faktura korygujaca): the FA(3) builder could only ever
-- emit RodzajFaktury=VAT - there was no way to issue a correction anywhere in
-- the product, despite it being routine work for an accounting office.
--
-- corrects_invoice_id links a correction to the invoice it corrects (needed
-- to compute the delta amounts the schema requires - see
-- ksef-invoice-builder.ts). correction_reason is PrzyczynaKorekty, the
-- required-in-practice free-text reason KSeF expects on a correction.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS corrects_invoice_id INT REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS correction_reason TEXT;
