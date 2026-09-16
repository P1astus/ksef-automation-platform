-- Round 7: invoices.processing_status had no distinct "sent to KSeF" or
-- "rejected by KSeF" state - ksef/send/route.ts set 'exported_jpk' the
-- instant sendInvoice() was accepted, which is neither "sent" (KSeF hadn't
-- even reached a terminal status yet) nor "exported to JPK" (nothing marks
-- that at JPK-generation time). A genuine KSeF rejection (status.code >= 400,
-- e.g. 440 "Duplikat faktury" - see getSessionInvoiceStatus() in
-- ksef-client.ts) was silently indistinguishable from "still processing"
-- forever, per ksef-send-upo-polling.test.ts's own documented gap.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_processing_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_processing_status_check
    CHECK (processing_status IN ('new', 'classified', 'sent', 'rejected', 'exported_jpk', 'error', 'duplicate'));

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ksef_rejection_reason TEXT;
