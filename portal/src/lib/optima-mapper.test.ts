import { describe, it, expect } from 'vitest';
import { generateOptimaXml, OptimaExportError } from './optima-mapper';

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
        const { xml } = generateOptimaXml([{ ...baseInvoice, direction: 'purchase' }]);
        expect(xml).toContain('<REJESTRY_ZAKUPOW_VAT>');
        expect(xml).toContain('<REJESTR_ZAKUPU_VAT>');
    });

    it('does not include an invoice with the invalid legacy spelling "purchases" in either register', () => {
        const { xml } = generateOptimaXml([{ ...baseInvoice, direction: 'purchases' }]);
        expect(xml).not.toContain('<REJESTRY_ZAKUPOW_VAT>');
        expect(xml).not.toContain('<REJESTRY_SPRZEDAZY_VAT>');
    });

    it('includes a sales invoice in the sales register', () => {
        const { xml } = generateOptimaXml([{ ...baseInvoice, direction: 'sales' }]);
        expect(xml).toContain('<REJESTRY_SPRZEDAZY_VAT>');
        expect(xml).not.toContain('<REJESTRY_ZAKUPOW_VAT>');
    });
});

describe('generateOptimaXml VAT rate derivation (D5)', () => {
    const invAt = (rate: string, net: number, overrides: Record<string, any> = {}) => {
        const vatRatio: Record<string, number> = { '23': 0.23, '8': 0.08, '5': 0.05, '0': 0, zw: 0, np: 0 };
        const vat = Math.round(net * vatRatio[rate] * 100) / 100;
        return {
            invoice_number: `FV/${rate}/2026`,
            issue_date: '2026-01-15',
            net_amount: String(net.toFixed(2)),
            vat_amount: String(vat.toFixed(2)),
            gross_amount: String((net + vat).toFixed(2)),
            ksef_number: `TEST-KSEF-${rate}`,
            seller_nip: '1111111111',
            buyer_nip: '2222222222',
            direction: 'sales',
            ...overrides,
        };
    };

    it.each(['23', '8', '5', '0'])('derives the %s%% rate from net/vat ratio when invoice_lines is absent', (rate) => {
        const inv = invAt(rate, 100);
        const { xml, ratioDerivedCount } = generateOptimaXml([inv]);
        expect(xml).toContain(`<STAWKA_VAT>${Number(rate).toFixed(2)}</STAWKA_VAT>`);
        expect(ratioDerivedCount).toBe(1);
    });

    it('never hardcodes 23% - a pure 8% invoice is not mislabeled as 23%', () => {
        const { xml } = generateOptimaXml([invAt('8', 100)]);
        expect(xml).toContain('<STAWKA_VAT>8.00</STAWKA_VAT>');
        expect(xml).not.toContain('<STAWKA_VAT>23.00</STAWKA_VAT>');
    });

    it('emits one POZYCJA per rate for a mixed-rate invoice using invoice_lines', () => {
        const inv = {
            ...invAt('23', 0),
            net_amount: '180.00',
            vat_amount: '27.00', // 23 on 100 + 8 on 80 = 23 + 6.40, illustrative header total, not used when invoice_lines is present
            invoice_lines: JSON.stringify([
                { vatRate: '23', net: 100 },
                { vatRate: '8', net: 80 },
            ]),
        };
        const { xml } = generateOptimaXml([inv]);
        expect(xml).toContain('<STAWKA_VAT>23.00</STAWKA_VAT>');
        expect(xml).toContain('<STAWKA_VAT>8.00</STAWKA_VAT>');
        expect((xml.match(/<POZYCJA>/g) || []).length).toBe(2);
    });

    it('a zw (zwolniony) invoice is read from invoice_lines, never inferred from a zero ratio', () => {
        const inv = {
            ...invAt('0', 0),
            net_amount: '500.00',
            vat_amount: '0.00',
            invoice_lines: JSON.stringify([{ vatRate: 'zw', net: 500 }]),
        };
        const { xml } = generateOptimaXml([inv]);
        expect(xml).toContain('<STAWKA_VAT>zw</STAWKA_VAT>');
    });

    it('fails loudly (throws, names the invoice) when no rate can be derived - never defaults to 23%', () => {
        // net/vat ratio of 13% matches no legal rate, and there's no invoice_lines
        const inv = invAt('23', 100, { vat_amount: '13.00', gross_amount: '113.00' });
        expect(() => generateOptimaXml([inv])).toThrow(OptimaExportError);
        try {
            generateOptimaXml([inv]);
        } catch (e) {
            expect(e).toBeInstanceOf(OptimaExportError);
            const err = e as OptimaExportError;
            expect(err.failures).toHaveLength(1);
            expect(err.failures[0].invoiceNumber).toBe(inv.invoice_number);
        }
    });

    it('a blended ratio with invoice_lines present but a line missing its rate fails loudly instead of guessing', () => {
        const inv = {
            ...invAt('23', 100),
            invoice_lines: JSON.stringify([{ vatRate: '23', net: 50 }, { net: 50 /* no vatRate */ }]),
        };
        expect(() => generateOptimaXml([inv])).toThrow(OptimaExportError);
    });

    it('one bad invoice does not block the rest of the export - all failures are collected, not just the first', () => {
        const good = invAt('23', 100);
        const bad1 = invAt('23', 100, { invoice_number: 'BAD-1', vat_amount: '13.00' });
        const bad2 = invAt('23', 100, { invoice_number: 'BAD-2', vat_amount: '17.00' });
        try {
            generateOptimaXml([good, bad1, bad2]);
            throw new Error('expected generateOptimaXml to throw');
        } catch (e) {
            expect(e).toBeInstanceOf(OptimaExportError);
            const err = e as OptimaExportError;
            expect(err.failures.map(f => f.invoiceNumber).sort()).toEqual(['BAD-1', 'BAD-2']);
        }
    });
});
