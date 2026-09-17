import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildKSeFInvoiceXml, type InvoiceInput } from '../ksef-invoice-builder';

// Round 10 removed the 'oo' (domestic reverse charge) VAT rate - art. 17
// ust. 1 pkt 7/8, the legal basis it modeled, was repealed 2019-11-01 and
// replaced by mandatory split payment (full VAT, not a zero-VAT line). See
// VatRateCode's doc comment in ksef-invoice-builder.ts for the full finding.
// These tests prove an unrecognized rate (a stale client still sending
// 'oo', or any other bad value) fails with a clear error, both at the
// route boundary and inside buildKSeFInvoiceXml itself - not with the
// opaque "Cannot read properties of undefined (reading 'p12')" crash this
// used to produce once 'oo' stopped being a key in VAT_GROUP_FIELD.

describe('buildKSeFInvoiceXml — rejects an unrecognized VAT rate', () => {
    const completeParty = { nip: '1111111111', name: 'Test', street: 'ul. Testowa 1', city: 'Warszawa', postCode: '00-001' };

    function invoiceInput(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
        return {
            invoiceNumber: 'FV/1/2026',
            issueDate: '2026-09-17',
            seller: { ...completeParty },
            buyer: { ...completeParty, nip: '2222222222' },
            lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' }],
            ...overrides,
        };
    }

    it('throws a clear error for the removed "oo" rate, not an opaque TypeError', () => {
        expect(() => buildKSeFInvoiceXml(invoiceInput({
            // cast: TypeScript's VatRateCode union no longer includes 'oo' -
            // this simulates a value that bypassed the type system (a stale
            // request body, or a pre-round-10 DB row).
            lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: 'oo' as InvoiceInput['lines'][number]['vatRate'] }],
        }))).toThrow(/Nieznana stawka VAT/i);
    });

    it('still builds fine for every currently-valid rate', () => {
        for (const rate of ['23', '8', '5', '0', '0-wdt', '0-export'] as const) {
            expect(() => buildKSeFInvoiceXml(invoiceInput({
                lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: rate }],
            }))).not.toThrow();
        }
    });
});

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1 })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] as any[] })) }));

function req(body: object) {
    return new Request('http://localhost/api/invoices/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('invoices/create/route.ts — rejects an unrecognized VAT rate before touching the DB', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 400 naming the bad rate, for "oo" specifically', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({
            clientId: 1,
            invoiceNumber: 'FV/1/2026',
            issueDate: '2026-09-17',
            buyerNip: '2222222222',
            buyerName: 'Nabywca',
            buyerStreet: 'ul. Nabywcza 1',
            buyerCity: 'Krakow',
            buyerPostalCode: '30-001',
            lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: 'oo' }],
            totals: { totalNet: 100, totalVat: 0, totalGross: 100 },
        }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/nieprawidłowa stawka vat/i);
        expect(body.error).toContain('oo');
    });
});
