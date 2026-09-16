import { describe, it, expect } from 'vitest';
import { buildKSeFInvoiceXml, type InvoiceInput } from '../ksef-invoice-builder';

// FA(3)'s AdresL1/AdresL2 are minLength=1 (schemas/fa3-13775-schemat.xsd) -
// found live-testing corrections (round 5) that neither clients (the seller
// on every invoice issued through this platform) nor the invoice-creation
// form (buyer) ever collected an address, so every invoice built through the
// manual-creation UI would be missing fields real KSeF submission requires
// non-empty. Round 6 fix: clients gained street/city/postal_code columns,
// invoices gained buyer_street/buyer_city/buyer_postal_code, and
// buildKSeFInvoiceXml now refuses to build with a missing address instead
// of silently emitting an empty AdresL1 - see invoices-create-correction.test.ts
// for the invoices/create/route.ts-level validation (which rejects before
// even reaching this function).

const baseLine = { name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' as const };
const completeParty = { nip: '1111111111', name: 'Test', street: 'ul. Testowa 1', city: 'Warszawa', postCode: '00-001' };

function invoiceInput(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
    return {
        invoiceNumber: 'FV/1/2026',
        issueDate: '2026-09-16',
        seller: { ...completeParty },
        buyer: { ...completeParty, nip: '2222222222' },
        lines: [baseLine],
        ...overrides,
    };
}

describe('buildKSeFInvoiceXml — address is required, not just optional metadata', () => {
    it('builds fine when both seller and buyer have a complete address', () => {
        expect(() => buildKSeFInvoiceXml(invoiceInput())).not.toThrow();
    });

    it('throws when the seller has no street', () => {
        expect(() => buildKSeFInvoiceXml(invoiceInput({ seller: { ...completeParty, street: '' } })))
            .toThrow(/adresu sprzedawcy/i);
    });

    it('throws when the seller address is entirely absent (undefined fields)', () => {
        expect(() => buildKSeFInvoiceXml(invoiceInput({ seller: { nip: '1111111111', name: 'Test' } })))
            .toThrow(/adresu sprzedawcy/i);
    });

    it('throws when the buyer has no postal code', () => {
        expect(() => buildKSeFInvoiceXml(invoiceInput({ buyer: { ...completeParty, nip: '2222222222', postCode: '   ' } })))
            .toThrow(/adresu nabywcy/i);
    });
});
