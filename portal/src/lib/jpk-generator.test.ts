import { describe, it, expect } from 'vitest';
import { generateJpkV7M, type JpkInvoiceRow } from './jpk-generator';
import type { InvoiceLine } from './ksef-invoice-builder';

const firm = { nip: '1234567890', name: 'Test Firm' };

function extractAll(xml: string, tag: string): string[] {
    const re = new RegExp(`<tns:${tag}>([^<]*)</tns:${tag}>`, 'g');
    return [...xml.matchAll(re)].map(m => m[1]);
}

function extractOne(xml: string, tag: string): number | undefined {
    const vals = extractAll(xml, tag);
    return vals.length ? Number(vals[0]) : undefined;
}

describe('generateJpkV7M invoice/total reconciliation', () => {
    const invoices: JpkInvoiceRow[] = [
        { id: 1, invoice_number: 'S-1', issue_date: '2026-01-05', seller_name: 'Firm', buyer_name: 'Buyer A', buyer_nip: '1111111111', net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales' },
        { id: 2, invoice_number: 'S-2', issue_date: '2026-01-12', seller_name: 'Firm', buyer_name: 'Buyer B', buyer_nip: '2222222222', net_amount: 200, vat_amount: 16, gross_amount: 216, direction: 'sales' },
        { id: 3, invoice_number: 'P-1', issue_date: '2026-01-20', seller_name: 'Seller A', seller_nip: '3333333333', buyer_name: 'Firm', net_amount: 50, vat_amount: 11.5, gross_amount: 61.5, direction: 'purchase', cost_category: 'usługi_IT' },
    ];

    it('every invoice in the period appears in the output', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        expect(xml).toContain('S-1');
        expect(xml).toContain('S-2');
        expect(xml).toContain('P-1');
        expect((xml.match(/<tns:SprzedazWiersz>/g) || []).length).toBe(2);
        expect((xml.match(/<tns:ZakupWiersz>/g) || []).length).toBe(1);
    });

    it('sales without line-level rate data fall back to the standard-rate (K_19/K_20) bucket', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        const k19s = extractAll(xml, 'K_19').map(Number);
        const k20s = extractAll(xml, 'K_20').map(Number);
        const salesNetSum = k19s.reduce((a, b) => a + b, 0);
        const salesVatSum = k20s.reduce((a, b) => a + b, 0);

        expect(salesNetSum).toBeCloseTo(300); // 100 + 200
        expect(salesVatSum).toBeCloseTo(39); // 23 + 16

        expect(extractOne(xml, 'LiczbaWierszySprzedazy')).toBe(2);
        expect(extractOne(xml, 'PodatekNalezny')).toBeCloseTo(salesVatSum);

        // No zw/0%/WDT/export/oo sales in this fixture, so those K/P fields
        // must not appear at all (they're optional and "pozostają puste").
        expect(xml).not.toContain('<tns:K_10>');
        expect(xml).not.toContain('<tns:P_10>');

        expect(extractOne(xml, 'P_19')).toBeCloseTo(salesNetSum);
        expect(extractOne(xml, 'P_20')).toBeCloseTo(salesVatSum);
        expect(extractOne(xml, 'P_38')).toBeCloseTo(salesVatSum); // mandatory total, always present
    });

    it('routes an ordinary purchase to K_42/K_43, never the fixed-asset K_40/K_41 fields', () => {
        // Regression guard for the bug where every purchase was reported to
        // the tax office as a środki trwałe (fixed-asset) acquisition.
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        expect(xml).not.toContain('<tns:K_40>');
        expect(xml).not.toContain('<tns:K_41>');
        expect(xml).not.toContain('<tns:P_40>');
        expect(xml).not.toContain('<tns:P_41>');
        // P_47 is a specific art. 89b ust. 4 correction field, not a "total
        // purchase VAT" field - must never hold the raw purchase VAT total.
        expect(xml).not.toContain('<tns:P_47>');

        const k42s = extractAll(xml, 'K_42').map(Number);
        const k43s = extractAll(xml, 'K_43').map(Number);
        expect(k42s.reduce((a, b) => a + b, 0)).toBeCloseTo(50);
        expect(k43s.reduce((a, b) => a + b, 0)).toBeCloseTo(11.5);

        expect(extractOne(xml, 'LiczbaWierszyZakupow')).toBe(1);
        expect(extractOne(xml, 'PodatekNaliczony')).toBeCloseTo(11.5);
        expect(extractOne(xml, 'P_42')).toBeCloseTo(50);
        expect(extractOne(xml, 'P_43')).toBeCloseTo(11.5);
        expect(extractOne(xml, 'P_48')).toBeCloseTo(11.5); // sum(P_39,P_41,P_43,...) = P_43 here
    });

    it('VAT payable reconciles as total output VAT minus total input VAT', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        // salesVat (39) - purchVat (11.5) = 27.5 payable, no surplus
        expect(extractOne(xml, 'P_51')).toBeCloseTo(27.5);
        expect(xml).not.toContain('<tns:P_53>');
        expect(xml).not.toContain('<tns:P_62>');
    });

    it('never writes a money amount into the boolean/flag fields P_58 or P_60', () => {
        // P_58 ("zwrot w terminie... 180 dni") and P_60 ("zwrot do
        // zaliczenia na poczet przyszłych zobowiązań") are refund-election
        // flags this platform never sets - a numeric VAT amount there was
        // the old bug, and this asserts the fields are omitted, not zeroed.
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        expect(xml).not.toContain('<tns:P_58>');
        expect(xml).not.toContain('<tns:P_60>');
    });

    it('an input-VAT surplus carries forward via P_53/P_62, not a bank-refund field', () => {
        const surplusInvoices: JpkInvoiceRow[] = [
            { id: 1, invoice_number: 'S-1', issue_date: '2026-01-05', seller_name: 'Firm', buyer_name: 'Buyer A', buyer_nip: '1111111111', net_amount: 100, vat_amount: 10, gross_amount: 110, direction: 'sales' },
            { id: 2, invoice_number: 'P-1', issue_date: '2026-01-20', seller_name: 'Seller A', seller_nip: '3333333333', buyer_name: 'Firm', net_amount: 500, vat_amount: 100, gross_amount: 600, direction: 'purchase', cost_category: 'sprzęt_IT' },
        ];
        const xml = generateJpkV7M(firm, '2026-01', surplusInvoices);
        expect(extractOne(xml, 'P_51')).toBeCloseTo(0); // nothing payable
        expect(extractOne(xml, 'P_53')).toBeCloseTo(90); // 100 input - 10 output
        expect(extractOne(xml, 'P_62')).toBeCloseTo(90);
        expect(xml).not.toContain('<tns:P_60>');
    });

    it('splits a multi-rate sales invoice across the correct K/P fields using its line-level VAT rates', () => {
        const lines: InvoiceLine[] = [
            { name: 'Standard service', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' },
            { name: 'Reduced-rate good', qty: 1, unit: 'szt', netPrice: 50, vatRate: '8' },
            { name: 'Exempt service', qty: 1, unit: 'szt', netPrice: 30, vatRate: 'zw' },
            { name: 'Intra-EU supply', qty: 1, unit: 'szt', netPrice: 200, vatRate: '0-wdt' },
            { name: 'Export of goods', qty: 1, unit: 'szt', netPrice: 300, vatRate: '0-export' },
        ];
        const mixedInvoice: JpkInvoiceRow[] = [{
            id: 1, invoice_number: 'S-MIX', issue_date: '2026-01-05', seller_name: 'Firm',
            buyer_name: 'Buyer A', buyer_nip: '1111111111',
            net_amount: 680, vat_amount: 27, gross_amount: 707, direction: 'sales',
            invoice_lines: lines,
        }];
        const xml = generateJpkV7M(firm, '2026-01', mixedInvoice);

        expect(extractOne(xml, 'K_19')).toBeCloseTo(100); // 23%
        expect(extractOne(xml, 'K_20')).toBeCloseTo(23);
        expect(extractOne(xml, 'K_17')).toBeCloseTo(50); // 8%
        expect(extractOne(xml, 'K_18')).toBeCloseTo(4);
        expect(extractOne(xml, 'K_10')).toBeCloseTo(30); // zw
        expect(extractOne(xml, 'K_21')).toBeCloseTo(200); // WDT
        expect(extractOne(xml, 'K_22')).toBeCloseTo(300); // export

        expect(extractOne(xml, 'P_19')).toBeCloseTo(100);
        expect(extractOne(xml, 'P_20')).toBeCloseTo(23);
        expect(extractOne(xml, 'P_17')).toBeCloseTo(50);
        expect(extractOne(xml, 'P_18')).toBeCloseTo(4);
        expect(extractOne(xml, 'P_10')).toBeCloseTo(30);
        expect(extractOne(xml, 'P_21')).toBeCloseTo(200);
        expect(extractOne(xml, 'P_22')).toBeCloseTo(300);
        // Total output VAT = 23 + 4 (5%/zw/WDT/export carry no VAT)
        expect(extractOne(xml, 'P_38')).toBeCloseTo(27);
        expect(extractOne(xml, 'PodatekNalezny')).toBeCloseTo(27);
    });

    it('an empty invoice list produces a valid, zeroed-out declaration rather than throwing', () => {
        const xml = generateJpkV7M(firm, '2026-01', []);
        expect(() => xml).not.toThrow();
        expect(xml).toContain('<tns:LiczbaWierszySprzedazy>0</tns:LiczbaWierszySprzedazy>');
        expect(xml).toContain('<tns:LiczbaWierszyZakupow>0</tns:LiczbaWierszyZakupow>');
        expect(extractOne(xml, 'P_38')).toBe(0); // mandatory, always present
        expect(extractOne(xml, 'P_51')).toBe(0); // mandatory, always present
    });

    // `pg` returns a DATE column as a JS Date object, not a string - every
    // test above used a string, which is what pglite/mocks hand back but
    // never what jpk/generate/route.ts actually gets from the live query.
    // The old `inv.issue_date.slice(0, 10)` threw a TypeError on a real Date
    // - this is the shape that would have caught it.
    it('accepts a real Date object for issue_date, not just a string', () => {
        const dateInvoices: JpkInvoiceRow[] = [
            { id: 1, invoice_number: 'S-1', issue_date: new Date(2026, 0, 5), seller_name: 'Firm', buyer_name: 'Buyer A', buyer_nip: '1111111111', net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales' },
        ];
        expect(() => generateJpkV7M(firm, '2026-01', dateInvoices)).not.toThrow();
        const xml = generateJpkV7M(firm, '2026-01', dateInvoices);
        expect(xml).toContain('<tns:DataWystawienia>2026-01-05</tns:DataWystawienia>');
    });
});
