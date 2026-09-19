import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 11: invoices/create/route.ts used to write a client-supplied
// `totals` object straight into invoices.net_amount/vat_amount/gross_amount
// with no check against `lines` at all — computeInvoiceTotals() (in
// ksef-invoice-builder.ts) existed to derive correct totals from lines but
// had zero call sites anywhere. The actual FA(3) XML (raw_xml) is built
// independently from `lines`, so a stale frontend, a rounding drift, or a
// direct API call could store a gross/net/vat that permanently disagreed
// with what was actually filed with KSeF — used for payment tracking,
// dashboards, the receivables digest, and jpk/generate's summary stats.
// Fixed by computing totals server-side via computeReportedTotals(), which
// this route now calls instead of trusting request.body.totals at all.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1 })),
    requireRole: vi.fn(async () => null),
}));

vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
// Plan/subscription gating has its own tests (entitlements.test.ts); here it must not be the thing under test.
vi.mock('@/lib/entitlements', () => ({
    requireFeature: vi.fn(async () => null),
    requireActiveSubscription: vi.fn(async () => null),
}));

const buildXmlMock = vi.fn((..._args: any[]) => '<fa:Faktura/>');
vi.mock('@/lib/ksef-invoice-builder', async () => {
    const actual = await vi.importActual<typeof import('@/lib/ksef-invoice-builder')>('@/lib/ksef-invoice-builder');
    return { ...actual, buildKSeFInvoiceXml: (...args: any[]) => buildXmlMock(...args) };
});

const queryMock = vi.fn(async (...args: any[]) => {
    const [sql] = args as [string];
    if (sql.includes('FROM clients')) {
        return { rows: [{ id: 1, nip: '1111111111', client_name: 'Sprzedawca', street: 'ul. A 1', city: 'Warszawa', postal_code: '00-001' }] };
    }
    if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
    if (sql.includes('INSERT INTO invoices')) return { rows: [{ id: 99 }] };
    return { rows: [] };
});
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

function req(body: object) {
    return new Request('http://localhost/api/invoices/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const baseBody = {
    clientId: 1,
    invoiceNumber: 'FV/1/2026',
    issueDate: '2026-09-17',
    buyerNip: '2222222222',
    buyerName: 'Nabywca',
    buyerStreet: 'ul. B 1',
    buyerCity: 'Krakow',
    buyerPostalCode: '30-001',
};

describe('invoices/create/route.ts — server-side totals (round 11 fix)', () => {
    beforeEach(() => {
        vi.resetModules();
        buildXmlMock.mockClear();
        queryMock.mockClear();
    });

    it('ignores a client-supplied totals object that disagrees with lines, storing the recomputed values instead', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({
            ...baseBody,
            lines: [{ name: 'Usluga', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' }],
            // Deliberately bogus — a naive implementation trusting this would
            // store 1/1/1 instead of the real 100/23/123.
            totals: { totalNet: 1, totalVat: 1, totalGross: 1 },
        }));
        expect(res.status).toBe(200);

        const insertCall = queryMock.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO invoices'));
        const params = insertCall![1] as any[];
        // net_amount, vat_amount, gross_amount are params[10], [11], [12] per
        // the INSERT's column list in invoices/create/route.ts.
        expect(params[10]).toBe(100);
        expect(params[11]).toBe(23);
        expect(params[12]).toBe(123);
    });

    it('computes totals correctly even with no totals field sent at all', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({
            ...baseBody,
            lines: [{ name: 'Usluga', qty: 2, unit: 'szt', netPrice: 50, vatRate: '8' }],
        }));
        expect(res.status).toBe(200);

        const insertCall = queryMock.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO invoices'));
        const params = insertCall![1] as any[];
        expect(params[10]).toBe(100);  // 50 * 2
        expect(params[11]).toBe(8);    // 8% of 100
        expect(params[12]).toBe(108);
    });
});
