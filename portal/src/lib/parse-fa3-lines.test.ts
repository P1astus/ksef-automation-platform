import { describe, it, expect } from 'vitest';
import { parseFa3Lines } from './parse-fa3-lines';
import { buildKSeFInvoiceXml } from './ksef-invoice-builder';

// The invoice preview page's line-items table (and the PDF route's raw_xml
// fallback) used to match a "WierszFaktury" tag the builder has never
// actually emitted, so both always silently rendered zero lines against any
// real invoice. This tests the fix against the builder's *real* output,
// not a hand-written XML fixture, so it would have caught the original bug.

const baseInput = {
    invoiceNumber: 'FV/1/2026',
    issueDate: '2026-09-16',
    seller: { nip: '1111111111', name: 'Sprzedawca', street: 'ul. Testowa 1', city: 'Warszawa', postCode: '00-001' },
    buyer: { nip: '2222222222', name: 'Nabywca', street: 'ul. Inna 2', city: 'Krakow', postCode: '00-002' },
};

describe('parseFa3Lines', () => {
    it('extracts every line from a real builder-generated invoice, not zero', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [
                { name: 'Towar A', qty: 2, unit: 'szt', netPrice: 50, vatRate: '23' },
                { name: 'Usluga B', qty: 1, unit: 'godz', netPrice: 200, vatRate: '8' },
            ],
        });

        const lines = parseFa3Lines(xml);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toEqual({ name: 'Towar A', qty: '2', unit: 'szt', netPrice: '50.00', net: '100.00', vatRate: '23' });
        expect(lines[1]).toEqual({ name: 'Usluga B', qty: '1', unit: 'godz', netPrice: '200.00', net: '200.00', vatRate: '8' });
    });

    it('reports the real VAT rate codes for the zero-VAT treatments, not a made-up gross value', () => {
        const xml = buildKSeFInvoiceXml({
            ...baseInput,
            lines: [{ name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 30, vatRate: 'zw' }],
            exemptionBasis: { type: 'ustawa', text: 'art. 113 ust. 1 ustawy o VAT' },
        });
        const lines = parseFa3Lines(xml);
        expect(lines).toHaveLength(1);
        expect(lines[0].vatRate).toBe('zw');
    });

    it('returns an empty array for XML with no FaWiersz blocks', () => {
        expect(parseFa3Lines('<fa:Faktura></fa:Faktura>')).toEqual([]);
    });

    it('does not match the old, never-emitted "WierszFaktury" tag name', () => {
        const xml = '<WierszFaktury><P_7>Old shape</P_7></WierszFaktury>';
        expect(parseFa3Lines(xml)).toEqual([]);
    });
});
