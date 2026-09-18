import { describe, it, expect, vi, beforeEach } from 'vitest';

// invoices/create/route.ts's new correctingInvoiceId path: proves the route
// rejects a correction with no reason, rejects correcting an invoice that
// was never actually sent to KSeF (no ksef_number) or has no saved
// invoice_lines to diff against, and — on the happy path — stores
// corrects_invoice_id/correction_reason and calls buildKSeFInvoiceXml with
// a correction object built from the real original row, not the request
// body (the request never supplies the original's ksef_number/lines itself,
// only its own id — those come from the DB lookup, so a caller can't spoof
// the delta by claiming an arbitrary "original").

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

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
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
    invoiceNumber: 'FV/2/2026',
    issueDate: '2026-09-20',
    buyerNip: '2222222222',
    buyerName: 'Nabywca',
    buyerStreet: 'ul. Nabywcza 1',
    buyerCity: 'Krakow',
    buyerPostalCode: '30-001',
    lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' }],
    totals: { totalNet: 100, totalVat: 23, totalGross: 123 },
};

const SELLER_CLIENT_ROW = { id: 1, nip: '1111111111', client_name: 'Sprzedawca', street: 'ul. Sprzedawcza 1', city: 'Warszawa', postal_code: '00-001' };

describe('invoices/create/route.ts — correction invoice path', () => {
    beforeEach(() => {
        vi.resetModules();
        buildXmlMock.mockClear();
        queryMock.mockReset();
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [SELLER_CLIENT_ROW] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('INSERT INTO invoices')) return { rows: [{ id: 99 }] };
            return { rows: [] };
        });
    });

    it('rejects a correction with no reason', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({ ...baseBody, correctingInvoiceId: 5 }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/powód korekty/i);
    });

    it('rejects correcting an invoice with no ksef_number (never actually sent)', async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [SELLER_CLIENT_ROW] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('FROM invoices WHERE id')) return { rows: [{ invoice_number: 'FV/1/2026', issue_date: '2026-09-14', ksef_number: null, invoice_lines: [] }] };
            return { rows: [] };
        });
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({ ...baseBody, correctingInvoiceId: 5, correctionReason: 'test' }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/nie została wysłana do KSeF/i);
    });

    it('rejects correcting an invoice with no saved invoice_lines', async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [SELLER_CLIENT_ROW] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('FROM invoices WHERE id')) return { rows: [{ invoice_number: 'FV/1/2026', issue_date: '2026-09-14', ksef_number: 'KSEF-1', invoice_lines: null }] };
            return { rows: [] };
        });
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({ ...baseBody, correctingInvoiceId: 5, correctionReason: 'test' }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/brak zapisanych pozycji/i);
    });

    it('on success: stores corrects_invoice_id/correction_reason and builds the XML with the DB-sourced original, not request data', async () => {
        const originalLines = [{ name: 'Y', qty: 1, unit: 'szt', netPrice: 200, vatRate: '8' }];
        // pg returns a DATE column as a real JS Date object, not a string -
        // using one here (not the string '2026-09-14') is what actually
        // caught the live bug where String(dateObject).slice(0,10) produced
        // "Mon Sep 14" instead of an ISO date; a string-literal mock would
        // never have exercised that path.
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [SELLER_CLIENT_ROW] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('FROM invoices WHERE id')) return { rows: [{ invoice_number: 'FV/1/2026', issue_date: new Date('2026-09-14T00:00:00.000Z'), ksef_number: 'KSEF-1', invoice_lines: originalLines }] };
            if (sql.includes('INSERT INTO invoices')) return { rows: [{ id: 99 }] };
            return { rows: [] };
        });

        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({ ...baseBody, correctingInvoiceId: 5, correctionReason: '  Poprawka ilości  ' }));
        expect(res.status).toBe(200);

        const [builderArg] = buildXmlMock.mock.calls[0];
        expect(builderArg.correction).toEqual({
            reason: 'Poprawka ilości', // trimmed
            originalInvoiceNumber: 'FV/1/2026',
            originalIssueDate: '2026-09-14',
            originalKsefNumber: 'KSEF-1',
            originalLines,
        });

        const insertCall = queryMock.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO invoices'));
        expect(insertCall![1]).toEqual(expect.arrayContaining([5, 'Poprawka ilości']));
    });
});

// Round 6: neither the seller (this client) nor the buyer (typed into the
// form) ever had an address anywhere, and FA(3) rejects an empty
// AdresL1/AdresL2 - see invoice-address-validation.test.ts for
// buildKSeFInvoiceXml's own guard. These prove the route rejects before
// ever calling the builder, with a message pointing at what to fix.
describe('invoices/create/route.ts — address validation', () => {
    beforeEach(() => {
        vi.resetModules();
        buildXmlMock.mockClear();
        queryMock.mockReset();
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [SELLER_CLIENT_ROW] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('INSERT INTO invoices')) return { rows: [{ id: 99 }] };
            return { rows: [] };
        });
    });

    it('rejects when the request has no buyer address at all', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const { buyerStreet, buyerCity, buyerPostalCode, ...withoutAddress } = baseBody;
        const res = await POST(req(withoutAddress));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/adres nabywcy/i);
        expect(buildXmlMock).not.toHaveBeenCalled();
    });

    it('rejects when the selected client (seller) has no address on file', async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [{ ...SELLER_CLIENT_ROW, street: null, city: null, postal_code: null }] };
            return { rows: [] };
        });
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req(baseBody));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/brak adresu klienta/i);
        expect(buildXmlMock).not.toHaveBeenCalled();
    });

    it('on success: passes both addresses through to the builder and stores the buyer address on the invoice row', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req(baseBody));
        expect(res.status).toBe(200);

        const [builderArg] = buildXmlMock.mock.calls[0];
        expect(builderArg.seller).toEqual(expect.objectContaining({ street: 'ul. Sprzedawcza 1', city: 'Warszawa', postCode: '00-001' }));
        expect(builderArg.buyer).toEqual(expect.objectContaining({ street: 'ul. Nabywcza 1', city: 'Krakow', postCode: '30-001' }));

        const insertCall = queryMock.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO invoices'));
        expect(insertCall![1]).toEqual(expect.arrayContaining(['ul. Nabywcza 1', 'Krakow', '30-001']));
    });
});

// Round 6: FA(3)'s Zwolnienie annotation requires a cited legal basis
// whenever any line is 'zw' - see invoice-address-validation.test.ts's
// sibling file ksef-invoice-builder.test.ts for the builder-level guard.
// These prove the route rejects before ever calling the builder.
describe('invoices/create/route.ts — exemption (zw) legal basis validation', () => {
    beforeEach(() => {
        vi.resetModules();
        buildXmlMock.mockClear();
        queryMock.mockReset();
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [SELLER_CLIENT_ROW] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('INSERT INTO invoices')) return { rows: [{ id: 99 }] };
            return { rows: [] };
        });
    });

    const zwLine = { name: 'Uslugi zwolnione', qty: 1, unit: 'szt', netPrice: 100, vatRate: 'zw' };

    it('rejects a zw-rate line with no exemption basis', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({ ...baseBody, lines: [zwLine] }));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/podstawę prawną zwolnienia/i);
        expect(buildXmlMock).not.toHaveBeenCalled();
    });

    it('rejects a zw-rate line with a blank exemption basis text', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req({ ...baseBody, lines: [zwLine], exemptionBasis: { type: 'ustawa', text: '   ' } }));
        expect(res.status).toBe(400);
        expect(buildXmlMock).not.toHaveBeenCalled();
    });

    it('accepts a zw-rate line once an exemption basis is provided, and passes it to the builder', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const exemptionBasis = { type: 'ustawa', text: 'art. 113 ust. 1 ustawy o VAT' };
        const res = await POST(req({ ...baseBody, lines: [zwLine], exemptionBasis }));
        expect(res.status).toBe(200);
        const [builderArg] = buildXmlMock.mock.calls[0];
        expect(builderArg.exemptionBasis).toEqual(exemptionBasis);
    });

    it('does not require an exemption basis when no line is zw', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(req(baseBody));
        expect(res.status).toBe(200);
    });
});
