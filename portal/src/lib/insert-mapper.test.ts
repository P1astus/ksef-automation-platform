import { describe, it, expect } from 'vitest';
import { generateInsertEpp } from './insert-mapper';

describe('generateInsertEpp direction handling', () => {
    const base = { invoice_number: 'FV/1/2026', net_amount: '100.00', vat_amount: '23.00', gross_amount: '123.00' };

    it('maps a sales invoice to type FS using the buyer NIP', () => {
        const epp = generateInsertEpp([{ ...base, direction: 'sales', buyer_nip: '1111111111', seller_nip: '2222222222' }]);
        expect(epp).toContain('FS,');
        expect(epp).toContain('1111111111');
        expect(epp).not.toContain('2222222222');
    });

    it('maps a purchase invoice to type FZ using the seller NIP', () => {
        const epp = generateInsertEpp([{ ...base, direction: 'purchase', buyer_nip: '1111111111', seller_nip: '2222222222' }]);
        expect(epp).toContain('FZ,');
        expect(epp).toContain('2222222222');
        expect(epp).not.toContain('1111111111');
    });

    it('passes vat_amount through as an absolute figure, not a rate', () => {
        const epp = generateInsertEpp([{ ...base, direction: 'sales', buyer_nip: '1111111111' }]);
        expect(epp).toContain('23.00');
    });
});
