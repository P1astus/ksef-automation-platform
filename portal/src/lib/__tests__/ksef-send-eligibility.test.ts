import { beforeEach, describe, expect, it, vi } from 'vitest';

// POST /api/ksef/send submits invoices to KSeF under the client's own token.
// Only this firm's unsent sales invoices may go: a purchase invoice (issued
// by someone else), an invoice KSeF already holds, or a client whose stored
// credential is a certificate bundle (not a token) must never be submitted.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1, role: 'owner', userId: null })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/entitlements', () => ({
    loadEntitlements: vi.fn(async () => ({ has: () => true, accessState: 'ok' })),
    subscriptionInactiveResponse: vi.fn(), upgradeRequiredResponse: vi.fn(),
}));
vi.mock('@/lib/credential-crypto', () => ({ clientCredentialContext: (id: number) => `ksef-client:${id}`, decryptSecret: () => 'plain-token' }));
const initInteractiveSession = vi.fn(async () => 'access');
vi.mock('@/lib/ksef-client', () => ({
    initInteractiveSession: (...a: unknown[]) => initInteractiveSession(...(a as [])),
    openOnlineSession: vi.fn(async () => ({ referenceNumber: 'S', keyBase64: 'k', ivBase64: 'i' })),
    encryptInvoiceForSession: vi.fn(async () => 'enc'),
    sendInvoice: vi.fn(async () => 'REF'),
    closeOnlineSession: vi.fn(async () => {}),
    terminateSession: vi.fn(async () => {}),
    getSessionInvoiceStatus: vi.fn(async () => { throw new Error('status unavailable in test'); }),
    downloadUpo: vi.fn(),
}));

let rows: Record<string, unknown>[] = [];
const queryMock = vi.fn(async (sql: string, _params?: unknown[]) => (/FROM invoices i/.test(sql) ? { rows } : { rows: [] }));
vi.mock('@/lib/db', () => ({ query: (sql: string, params?: unknown[]) => queryMock(sql, params) }));

const base = { raw_xml: '<x/>', nip: '1234563218', client_name: 'C', client_id: 7, ksef_token_encrypted: 'enc:v1:x', auth_method: 'token', processing_status: 'new', ksef_number: null, direction: 'sales' };
const post = (body: unknown) => new Request('http://localhost/api/ksef/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sentUpdates = () => queryMock.mock.calls.filter(([sql]) => /processing_status = 'sent'/.test(sql)).map(([, p]) => (p as unknown[])[0]);

beforeEach(() => { queryMock.mockClear(); initInteractiveSession.mockClear(); });

describe('ksef/send eligibility', () => {
    it('rejects malformed or oversized id lists before touching the database', async () => {
        const { POST } = await import('@/app/api/ksef/send/route');
        for (const invoiceIds of [['1 OR 1=1'], [1.5], [-3], Array.from({ length: 101 }, (_, i) => i + 1)]) {
            const res = await POST(post({ invoiceIds }));
            expect(res.status).toBe(400);
        }
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('sends an unsent sales invoice but refuses purchases, already-submitted invoices and certificate clients', async () => {
        rows = [
            { ...base, id: 1, invoice_number: 'OK' },
            { ...base, id: 2, invoice_number: 'P', direction: 'purchase' },
            { ...base, id: 3, invoice_number: 'S', processing_status: 'sent' },
            { ...base, id: 4, invoice_number: 'K', ksef_number: '1234563218-20260101-ABCDEF123456-01' },
            { ...base, id: 5, invoice_number: 'E', processing_status: 'exported_jpk' },
        ];
        const { POST } = await import('@/app/api/ksef/send/route');
        const body = await (await POST(post({ invoiceIds: [1, 2, 3, 4, 5] }))).json();
        expect(sentUpdates()).toEqual([1]);
        const errors = Object.fromEntries(body.results.filter((r: any) => r.error).map((r: any) => [r.id, r.error]));
        expect(Object.keys(errors).sort()).toEqual(['2', '3', '4', '5']);
    });

    it('never passes a certificate bundle to KSeF as a token', async () => {
        rows = [{ ...base, id: 9, invoice_number: 'C', auth_method: 'certificate', nip: '9999999999', client_id: 8 }];
        const { POST } = await import('@/app/api/ksef/send/route');
        const body = await (await POST(post({ invoiceIds: [9] }))).json();
        expect(initInteractiveSession).not.toHaveBeenCalled();
        expect(body.results[0]).toMatchObject({ id: 9, error: expect.stringMatching(/certyfikat/i) });
    });
});
