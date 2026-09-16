-- Round 6: seller/buyer address data. FA(3) requires AdresL1/AdresL2 non-empty
-- (schemas/fa3-13775-schemat.xsd) but neither the seller (clients, the
-- accounting firm's own client whose invoices get issued) nor the buyer
-- (arbitrary counterparty typed into invoices/new) ever had anywhere to put
-- one. Nullable because existing clients have no address on file yet - the
-- create route in the portal enforces non-empty at invoice-creation time
-- instead, so an invoice can never be built with an empty AdresL1 even
-- though the column itself allows it for not-yet-completed clients.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS street VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS city VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS postal_code VARCHAR(10);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_street VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_city VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_postal_code VARCHAR(10);
