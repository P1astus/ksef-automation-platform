import { describe, it, expect } from 'vitest';
import { generateOptimaXml } from './optima-mapper';

describe('generateOptimaXml direction handling (D4)', () => {
    const baseInvoice = {
        invoice_number: 'FV/1/2026',
        issue_date: '2026-01-15',
        net_amount: '100.00',
        vat_amount: '23.00',
        gross_amount: '123.00',
        ksef_number: 'TEST-KSEF-1',
        seller_nip: '1111111111',
        buyer_nip: '2222222222',
    };

    it('includes a schema-valid purchase invoice (direction: "purchase") in the purchase register', () => {
        const xml = generateOptimaXml([{ ...baseInvoice, direction: 'purchase' }]);
        expect(xml).toContain('<REJESTRY_ZAKUPOW_VAT>');
        expect(xml).toContain('<REJESTR_ZAKUPU_VAT>');
    });

    it('does not include an invoice with the invalid legacy spelling "purchases" in either register', () => {
        const xml = generateOptimaXml([{ ...baseInvoice, direction: 'purchases' }]);
        expect(xml).not.toContain('<REJESTRY_ZAKUPOW_VAT>');
        expect(xml).not.toContain('<REJESTRY_SPRZEDAZY_VAT>');
    });

    it('includes a sales invoice in the sales register', () => {
        const xml = generateOptimaXml([{ ...baseInvoice, direction: 'sales' }]);
        expect(xml).toContain('<REJESTRY_SPRZEDAZY_VAT>');
        expect(xml).not.toContain('<REJESTRY_ZAKUPOW_VAT>');
    });
});
