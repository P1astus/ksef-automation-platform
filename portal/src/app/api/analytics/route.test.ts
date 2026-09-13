import { describe, it, expect, vi } from 'vitest';

// D6: analytics used to compute estimatedIncomeTax = (salesNet - purchaseNet)
// * 0.19, assuming every client is on a flat 19% liniowy rate. Clients can be
// on skala (12/32%), liniowy (19%), ryczałt (varies) or CIT - a confidently
// wrong tax figure shown to a professional accountant is worse than none.
// Proves the estimate is gone from the response entirely, and that the VAT
// liability estimate (which the brief did not ask to remove) still works.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1, adminEmail: 'a@b.com' })),
}));

vi.mock('@/lib/db', () => ({
    query: vi.fn(async () => ({
        rows: [
            { direction: 'sales', net_sum: '1000.00', vat_sum: '230.00', gross_sum: '1230.00' },
            { direction: 'purchase', net_sum: '400.00', vat_sum: '92.00', gross_sum: '492.00' },
        ],
    })),
}));

describe('analytics route income tax removal (D6)', () => {
    it('the response has no income-tax estimate field anywhere', async () => {
        const { GET } = await import('./route');
        const res = await GET(new Request('http://localhost/api/analytics'));
        const body = await res.json();

        expect(body.currentMonth.estimates).not.toHaveProperty('incomeTax19');
        expect(JSON.stringify(body)).not.toMatch(/incomeTax/i);
    });

    it('still returns the VAT liability estimate correctly (sales VAT - purchase VAT)', async () => {
        const { GET } = await import('./route');
        const res = await GET(new Request('http://localhost/api/analytics'));
        const body = await res.json();

        expect(body.currentMonth.estimates.vatLiability).toBeCloseTo(230 - 92);
        expect(body.currentMonth.sales.net).toBeCloseTo(1000);
        expect(body.currentMonth.purchases.net).toBeCloseTo(400);
    });
});
