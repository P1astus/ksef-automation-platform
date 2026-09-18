import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 14: routes must enforce plan + subscription server-side. Real
// entitlements module, mocked DB: the firm row decides everything.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1, role: 'owner', userId: null })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

let firmRow: Record<string, unknown> | undefined;
let offlineOpenIds: number[] = [];
const defaultQuery = async (sql: string, _params?: unknown[]) => {
    if (/FROM firms WHERE id/.test(sql)) return { rows: firmRow ? [firmRow] : [] };
    if (/FROM offline_invoices/.test(sql)) return { rows: offlineOpenIds.map(id => ({ invoice_id: id })) };
    if (/FROM invoices i/.test(sql)) return { rows: [{ id: 10, invoice_number: 'FV/1', raw_xml: '<x/>', direction: 'sales', nip: '1234563218', client_name: 'C', ksef_token_encrypted: null }] };
    return { rows: [] };
};
const queryMock = vi.fn(defaultQuery);
vi.mock('@/lib/db', () => ({
    query: (sql: string, params?: unknown[]) => queryMock(sql, params),
    default: { connect: vi.fn() },
}));

const start = { subscription_tier: 'start', subscription_status: 'active', trial_expires_at: null };
const biznes = { subscription_tier: 'biznes', subscription_status: 'active', trial_expires_at: null };

function post(url: string, body: object) {
    return new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => { firmRow = start; offlineOpenIds = []; queryMock.mockReset(); queryMock.mockImplementation(defaultQuery); });

describe('invoice_issuance: creation and sending are one capability', () => {
    it('invoices/create refuses a Start firm with PLAN_UPGRADE_REQUIRED before any write', async () => {
        const { POST } = await import('@/app/api/invoices/create/route');
        const res = await POST(post('/api/invoices/create', { clientId: 1, lines: [] }));
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED', feature: 'invoice_issuance', requiredPlan: 'biznes' });
        expect(queryMock.mock.calls.some(([sql]) => /INSERT/i.test(sql))).toBe(false);
    });

    it('ksef/send refuses a Start firm for an invoice with no open offline deadline', async () => {
        const { POST } = await import('@/app/api/ksef/send/route');
        const res = await POST(post('/api/ksef/send', { invoiceIds: [10] }));
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('ksef/send: a lapsed subscription gets 402, not a silent pass', async () => {
        firmRow = { ...biznes, subscription_status: 'canceled' };
        const { POST } = await import('@/app/api/ksef/send/route');
        const res = await POST(post('/api/ksef/send', { invoiceIds: [10] }));
        expect(res.status).toBe(402);
        expect((await res.json()).code).toBe('SUBSCRIPTION_INACTIVE');
    });

    it('ksef/send: a downgraded firm may still submit an invoice with an open offline deadline (gate passes)', async () => {
        offlineOpenIds = [10];
        const { POST } = await import('@/app/api/ksef/send/route');
        const res = await POST(post('/api/ksef/send', { invoiceIds: [10] }));
        // Past the gate it proceeds to KSeF for the client; anything but the
        // plan/subscription refusals proves the exemption applied.
        expect([402, 403]).not.toContain(res.status);
        const offlineQuery = queryMock.mock.calls.find(([sql]) => /FROM offline_invoices/.test(sql))!;
        expect(offlineQuery[0]).toMatch(/uploaded_to_ksef = false/);
        expect(offlineQuery[1]).toEqual([1, [10]]);
    });

    it('ksef/send: a mixed request (one offline-pending, one not) is refused whole', async () => {
        offlineOpenIds = [10];
        const { POST } = await import('@/app/api/ksef/send/route');
        queryMock.mockImplementation(async (sql: string) => {
            if (/FROM firms WHERE id/.test(sql)) return { rows: [start] };
            if (/FROM offline_invoices/.test(sql)) return { rows: [{ invoice_id: 10 }] };
            if (/FROM invoices i/.test(sql)) return { rows: [{ id: 10, nip: '1', ksef_token_encrypted: null }, { id: 11, nip: '1', ksef_token_encrypted: null }] };
            return { rows: [] };
        });
        const res = await POST(post('/api/ksef/send', { invoiceIds: [10, 11] }));
        expect(res.status).toBe(403);
    });
});

describe('exports', () => {
    it('both export routes refuse Start, allow Biznes past the gate', async () => {
        const generic = await import('@/app/api/export/route');
        const optima = await import('@/app/api/export/optima/route');
        for (const POST of [generic.POST, optima.POST]) {
            firmRow = start;
            const denied = await POST(post('/api/export', { invoiceIds: [1], system: 'optima' }));
            expect(denied.status).toBe(403);
            expect((await denied.json()).feature).toBe('exports');
        }
    });
});

describe('subscription state is enforced on plain write routes too', () => {
    it('an expired trial cannot create a client via the API', async () => {
        firmRow = { subscription_tier: 'biznes', subscription_status: 'trial', trial_expires_at: new Date(Date.now() - 1000) };
        const { POST } = await import('@/app/api/clients/route');
        const res = await POST(post('/api/clients', { nip: '1234563218', client_name: 'X' }));
        expect(res.status).toBe(402);
    });

    it.each([
        ['client CRM changes', async () => {
            const route = await import('@/app/api/clients/[id]/route');
            return route.PATCH(post('/api/clients/1', { notes: 'changed' }), { params: Promise.resolve({ id: '1' }) });
        }],
        ['invoice payment changes', async () => {
            const route = await import('@/app/api/invoices/[id]/payment/route');
            return route.PATCH(post('/api/invoices/1/payment', { payment_status: 'paid' }), { params: Promise.resolve({ id: '1' }) });
        }],
        ['invoice workflow-status changes', async () => {
            const route = await import('@/app/api/invoices/[id]/xml/route');
            return route.PATCH(post('/api/invoices/1/xml', { processing_status: 'classified' }), { params: Promise.resolve({ id: '1' }) });
        }],
        ['KSeF credential changes', async () => {
            const route = await import('@/app/api/settings/ksef/route');
            return route.POST(post('/api/settings/ksef', { client_id: '1', auth_method: 'token', token: 'secret' }));
        }],
    ] as const)('%s are blocked before mutation when the subscription is canceled', async (_name, callRoute) => {
        firmRow = { ...biznes, subscription_status: 'canceled' };
        const response = await callRoute();
        expect(response.status).toBe(402);
        expect(await response.json()).toMatchObject({ code: 'SUBSCRIPTION_INACTIVE', state: 'canceled' });
        expect(queryMock.mock.calls.some(([sql]) => /^\s*UPDATE/i.test(sql))).toBe(false);
    });
});
