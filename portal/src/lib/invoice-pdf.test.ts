import { describe, it, expect } from 'vitest';
import { buildInvoicePdf } from './invoice-pdf';

describe('buildInvoicePdf', () => {
    it('produces a non-empty buffer starting with the PDF magic bytes', async () => {
        const buf = await buildInvoicePdf({
            invoiceNumber: 'FV/1/2026',
            ksefNumber: '1111111111-20260914-010080DD2B5E-26',
            direction: 'sales',
            issueDate: '2026-09-14',
            sellerName: 'Sprzedawca Sp. z o.o.',
            sellerNip: '1111111111',
            buyerName: 'Nabywca Sp. z o.o.',
            buyerNip: '2222222222',
            netAmount: 100,
            vatAmount: 23,
            grossAmount: 123,
            currency: 'PLN',
            lines: [{ name: 'Usługa testowa', qty: 1, unit: 'szt', net: 100, vat: 23, gross: 123 }],
        });

        expect(buf.length).toBeGreaterThan(0);
        expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    });

    it('handles multiple lines and a purchase-direction invoice without throwing', async () => {
        const buf = await buildInvoicePdf({
            invoiceNumber: 'FV/2/2026',
            ksefNumber: null,
            direction: 'purchase',
            issueDate: '2026-09-14',
            sellerName: 'Dostawca',
            sellerNip: '3333333333',
            buyerName: 'My Firm',
            buyerNip: '4444444444',
            netAmount: 300,
            vatAmount: 39,
            grossAmount: 339,
            currency: 'PLN',
            lines: [
                { name: 'Towar A', qty: 2, unit: 'szt', net: 100, vat: 23, gross: 123 },
                { name: 'Usługa B', qty: 1, unit: 'godz', net: 200, vat: 16, gross: 216 },
            ],
        });
        expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    });

    it('uses the buyer-facing VAT-marża layout with no net or VAT values', async () => {
        const buf = await buildInvoicePdf({
            invoiceNumber: 'M/1/2026', ksefNumber: null, direction: 'sales', issueDate: '2026-09-19',
            sellerName: 'Sprzedawca', sellerNip: '1111111111', buyerName: 'Nabywca', buyerNip: '2222222222',
            netAmount: 0, vatAmount: 0, grossAmount: 1230, currency: 'PLN', isMarginScheme: true,
            lines: [{ name: 'Towar używany', qty: 1, unit: 'szt', net: 999999, vat: 999999, gross: 999999 }],
        });
        const text = buf.toString('latin1');
        expect(text).not.toContain('999999');
        expect(text).not.toContain('Razem netto');
        expect(text).not.toContain('VAT:');
    });
});
