import { describe, it, expect } from 'vitest';
import { mapVatColumns } from './vat-mapper';

describe('mapVatColumns category mapping', () => {
    it('maps a known category to its KPiR column and VAT register fields', () => {
        const result = mapVatColumns('transport');
        expect(result.kpirColumn).toBe('13');
        expect(result.vatRegisterField).toBe('K_40');
        expect(result.vatRegisterField2).toBe('K_41');
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
