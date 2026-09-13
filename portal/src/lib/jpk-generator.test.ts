import { describe, it, expect } from 'vitest';
import { generateJpkV7M, type JpkInvoiceRow } from './jpk-generator';

const firm = { nip: '1234567890', name: 'Test Firm' };

function extractAll(xml: string, tag: string): string[] {
    const re = new RegExp(`<tns:${tag}>([^<]*)</tns:${tag}>`, 'g');
    return [...xml.matchAll(re)].map(m => m[1]);
}

describe('generateJpkV7M invoice/total reconciliation', () => {
    const invoices: JpkInvoiceRow[] = [
        { id: 1, invoice_number: 'S-1', issue_date: '2026-01-05', seller_name: 'Firm', buyer_name: 'Buyer A', buyer_nip: '1111111111', net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales' },
        { id: 2, invoice_number: 'S-2', issue_date: '2026-01-12', seller_name: 'Firm', buyer_name: 'Buyer B', buyer_nip: '2222222222', net_amount: 200, vat_amount: 16, gross_amount: 216, direction: 'sales' },
        { id: 3, invoice_number: 'P-1', issue_date: '2026-01-20', seller_name: 'Seller A', seller_nip: '3333333333', buyer_name: 'Firm', net_amount: 50, vat_amount: 11.5, gross_amount: 61.5, direction: 'purchase' },
    ];

    it('every invoice in the period appears in the output', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        expect(xml).toContain('S-1');
        expect(xml).toContain('S-2');
        expect(xml).toContain('P-1');
        expect((xml.match(/<tns:SprzedazWiersz>/g) || []).length).toBe(2);
        expect((xml.match(/<tns:ZakupWiersz>/g) || []).length).toBe(1);
    });

    it('sales control totals (K_19/K_20 sums) reconcile with SprzedazCtrl and the declaration', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        const k19s = extractAll(xml, 'K_19').map(Number);
        const k20s = extractAll(xml, 'K_20').map(Number);
        const salesNetSum = k19s.reduce((a, b) => a + b, 0);
        const salesVatSum = k20s.reduce((a, b) => a + b, 0);

        expect(salesNetSum).toBeCloseTo(300); // 100 + 200
        expect(salesVatSum).toBeCloseTo(39); // 23 + 16

        const [liczbaWierszySprzedazy] = extractAll(xml, 'LiczbaWierszySprzedazy');
        const [podatekNalezny] = extractAll(xml, 'PodatekNalezny');
        expect(Number(liczbaWierszySprzedazy)).toBe(2);
        expect(Number(podatekNalezny)).toBeCloseTo(salesVatSum);

        const [p10] = extractAll(xml, 'P_10');
        const [p20] = extractAll(xml, 'P_20');
        const [p38] = extractAll(xml, 'P_38');
        expect(Number(p10)).toBeCloseTo(salesNetSum);
        expect(Number(p20)).toBeCloseTo(salesVatSum);
        expect(Number(p38)).toBeCloseTo(salesVatSum);
    });

    it('purchase control totals (K_40/K_41 sums) reconcile with ZakupCtrl and the declaration', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        const k40s = extractAll(xml, 'K_40').map(Number);
        const k41s = extractAll(xml, 'K_41').map(Number);
        const purchNetSum = k40s.reduce((a, b) => a + b, 0);
        const purchVatSum = k41s.reduce((a, b) => a + b, 0);

        expect(purchNetSum).toBeCloseTo(50);
        expect(purchVatSum).toBeCloseTo(11.5);

        const [liczbaWierszyZakupow] = extractAll(xml, 'LiczbaWierszyZakupow');
        const [podatekNaliczony] = extractAll(xml, 'PodatekNaliczony');
        expect(Number(liczbaWierszyZakupow)).toBe(1);
        expect(Number(podatekNaliczony)).toBeCloseTo(purchVatSum);

        const [p40] = extractAll(xml, 'P_40');
        const [p41] = extractAll(xml, 'P_41');
        const [p47] = extractAll(xml, 'P_47');
        expect(Number(p40)).toBeCloseTo(purchNetSum);
        expect(Number(p41)).toBeCloseTo(purchVatSum);
        expect(Number(p47)).toBeCloseTo(purchVatSum);
    });

    it('VAT payable/refund reconcile with sales VAT minus purchase VAT', () => {
        const xml = generateJpkV7M(firm, '2026-01', invoices);
        // salesVat (39) > purchVat (11.5) -> payable = 27.5, refund = 0
        const [p51] = extractAll(xml, 'P_51');
        const [p58] = extractAll(xml, 'P_58');
        const [p60] = extractAll(xml, 'P_60');
        expect(Number(p51)).toBeCloseTo(27.5);
        expect(Number(p58)).toBeCloseTo(27.5);
        expect(Number(p60)).toBeCloseTo(0);
    });

    it('an empty invoice list produces a valid, zeroed-out declaration rather than throwing', () => {
        const xml = generateJpkV7M(firm, '2026-01', []);
        expect(() => xml).not.toThrow();
        expect(xml).toContain('<tns:LiczbaWierszySprzedazy>0</tns:LiczbaWierszySprzedazy>');
        expect(xml).toContain('<tns:LiczbaWierszyZakupow>0</tns:LiczbaWierszyZakupow>');
    });
});
