import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 17: jpk/generate must refuse (422, with the full problem list) when a
// valid JPK_V7M(3) file can't be produced - and must not record history or mark
// invoices exported for a file that was never delivered.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1 })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/entitlements', () => ({ requireActiveSubscription: vi.fn(async () => null) }));
const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

import { POST } from '@/app/api/jpk/generate/route';

const post = (body: object) => POST(new Request('http://x/api/jpk/generate', { method: 'POST', body: JSON.stringify(body) }));
const KSEF = '1234567890-20260205-ABCDEF-123456-7A';
const invoiceRow = (over: object = {}) => ({
    id: 1, invoice_number: 'FV/1', issue_date: '2026-02-05', seller_name: 'K', buyer_name: 'B', buyer_nip: '1111111111',
    net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales', ksef_number: KSEF, ...over,
});

function mockDb(client: object, invoices: object[]) {
    queryMock.mockImplementation(async (sql: string) => {
        if (/FROM clients/.test(sql)) return { rows: [client] };
        if (/FROM firms/.test(sql)) return { rows: [{ firm_name: 'Biuro' }] };
        if (/FROM invoices/.test(sql)) return { rows: invoices };
        return { rows: [] };
    });
}
const okClient = { id: 1, nip: '1234567890', client_name: 'Klient', tax_office_code: '1471', contact_email: 'k@example.com' };

describe('POST /api/jpk/generate refusal', () => {
    beforeEach(() => queryMock.mockReset());

    it('422s listing every problem, and writes nothing', async () => {
        mockDb({ ...okClient, tax_office_code: null }, [invoiceRow({ ksef_number: null, jpk_marker: null })]);
        const res = await post({ clientNip: '1234567890', period: '2026-02' });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.problems).toHaveLength(2);
        expect(body.error).toContain('urzędu skarbowego');
        expect(body.error).toContain('FV/1');
        const writes = queryMock.mock.calls.filter(c => /^\s*(INSERT|UPDATE)/i.test(String(c[0])));
        expect(writes).toHaveLength(0);
    });

    it('reads the client tax office and e-mail and succeeds when complete', async () => {
        mockDb(okClient, [invoiceRow()]);
        const res = await post({ clientNip: '1234567890', period: '2026-02' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.xml).toContain('<tns:KodUrzedu>1471</tns:KodUrzedu>');
        expect(body.xml).toContain('<tns:Email>k@example.com</tns:Email>');
    });
});
