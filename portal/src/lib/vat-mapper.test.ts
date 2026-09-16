import { describe, it, expect } from 'vitest';
import { mapVatColumns } from './vat-mapper';

describe('mapVatColumns category mapping', () => {
    it('maps a known category to its KPiR column and VAT register fields', () => {
        const result = mapVatColumns('transport');
        expect(result.kpirColumn).toBe('13');
        expect(result.vatRegisterField).toBe('K_42');
        expect(result.vatRegisterField2).toBe('K_43');
    });

    it('never routes an ordinary operating cost to the fixed-asset fields K_40/K_41', () => {
        // K_40/K_41 are reserved for środki trwałe (fixed-asset) purchases per
        // the JPK_V7 spec — routing ordinary costs there mislabels every
        // purchase as a fixed-asset acquisition on the real tax declaration.
        for (const category of ['transport', 'paliwo', 'materiały_biurowe', 'sprzęt_IT', 'usługi_IT',
            'media', 'wynajem', 'marketing', 'usługi_księgowe', 'usługi_budowlane', 'inne']) {
            const result = mapVatColumns(category);
            expect(result.vatRegisterField).toBe('K_42');
            expect(result.vatRegisterField2).toBe('K_43');
        }
    });

    it('falls back to the default mapping for an unrecognized category', () => {
        const result = mapVatColumns('some_unknown_category' as any);
        expect(result.kpirColumn).toBe('13');
    });

    it('falls back to the default mapping for null/undefined', () => {
        expect(mapVatColumns(null).kpirColumn).toBe('13');
        expect(mapVatColumns(undefined).kpirColumn).toBe('13');
    });
});
