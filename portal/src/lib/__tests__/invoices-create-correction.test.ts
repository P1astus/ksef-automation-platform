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
    lines: [{ name: 'X', qty: 1, unit: 'szt', netPrice: 100, vatRate: '23' }],
    totals: { totalNet: 100, totalVat: 23, totalGross: 123 },
};

describe('invoices/create/route.ts — correction invoice path', () => {
    beforeEach(() => {
        vi.resetModules();
        buildXmlMock.mockClear();
        queryMock.mockReset();
        queryMock.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '1111111111', client_name: 'Sprzedawca' }] };
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
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '1111111111', client_name: 'Sprzedawca' }] };
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
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '1111111111', client_name: 'Sprzedawca' }] };
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
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '1111111111', client_name: 'Sprzedawca' }] };
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
