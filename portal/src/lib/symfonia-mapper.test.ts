import { describe, it, expect } from 'vitest';
import { generateSymfoniaTxt } from './symfonia-mapper';

describe('generateSymfoniaTxt direction handling', () => {
    const base = { invoice_number: 'FV/1/2026', issue_date: '2026-01-15', net_amount: '100.00', vat_amount: '23.00', gross_amount: '123.00' };

    it('maps a sales invoice to SPRZEDAZ using the buyer NIP', () => {
        const txt = generateSymfoniaTxt([{ ...base, direction: 'sales', buyer_nip: '1111111111', seller_nip: '2222222222' }]);
        expect(txt).toContain('SPRZEDAZ');
        expect(txt).toContain('1111111111');
        expect(txt).not.toContain('ZAKUP\t');
    });

    it('maps a purchase invoice to ZAKUP', () => {
        const txt = generateSymfoniaTxt([{ ...base, direction: 'purchase', buyer_nip: '1111111111', seller_nip: '2222222222' }]);
        expect(txt).toContain('ZAKUP');
    });

    it('documents current (pre-existing, not part of this pass) behavior: buyer_nip is always preferred over seller_nip, even for a purchase row', () => {
        const txt = generateSymfoniaTxt([{ ...base, direction: 'purchase', buyer_nip: '1111111111', seller_nip: '2222222222' }]);
        expect(txt).toContain('1111111111');
        expect(txt).not.toContain('2222222222');
    });

    it('passes vat_amount through as an absolute figure, not a rate', () => {
        const txt = generateSymfoniaTxt([{ ...base, direction: 'sales', buyer_nip: '1111111111' }]);
        expect(txt).toContain('23.00');
    });
});
