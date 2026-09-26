import { beforeEach, describe, expect, it, vi } from 'vitest';

// A malformed [id] path segment is a client error: answer 400 before any
// query, instead of letting Postgres reject the integer cast (a 500).
vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1, role: 'owner', userId: null })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/entitlements', () => ({
    requireActiveSubscription: vi.fn(async () => null),
    requireFeature: vi.fn(async () => null),
    requireReadFeature: vi.fn(async () => null),
    requireLicenceWrite: vi.fn(async () => null),
    loadEntitlements: vi.fn(async () => ({ has: () => true, accessState: 'ok' })),
}));
const queryMock = vi.fn(async (..._a: unknown[]) => ({ rows: [] }));
vi.mock('@/lib/db', () => ({ query: (...a: unknown[]) => queryMock(...a), default: { query: (...a: unknown[]) => queryMock(...a), connect: vi.fn() } }));

const routes: [string, string, unknown?][] = [
    ['clients/[id]/route', 'GET'], ['clients/[id]/route', 'PATCH', { notes: 'x' }],
    ['clients/[id]/erase/route', 'POST', {}], ['clients/[id]/request-documents/route', 'POST', {}],
    ['clients/[id]/sync/route', 'POST', {}],
    ['invoices/[id]/download/route', 'GET'], ['invoices/[id]/jpk-markers/route', 'PATCH', { gtu: [] }],
    ['invoices/[id]/payment/route', 'PATCH', { payment_status: 'paid' }], ['invoices/[id]/pdf/route', 'GET'],
    ['invoices/[id]/upo/route', 'GET'], ['invoices/[id]/xml/route', 'GET'], ['invoices/[id]/xml/route', 'PATCH', { processing_status: 'new' }],
    ['ocr-queue/[id]/file/route', 'GET'], ['ocr-queue/[id]/route', 'PATCH', { action: 'reject' }],
    ['zus/declarations/[id]/download/route', 'GET'],
];

beforeEach(() => queryMock.mockClear());

describe.each(routes)('%s %s', (path, method, body) => {
    it.each(['abc', '1 OR 1=1', '-1', '0', '1.5', '99999999999999999999'])('rejects id %j with 400 before querying with it', async (id) => {
        const mod = await import(`@/app/api/${path}`);
        const res = await mod[method](
            new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(400);
        expect(queryMock.mock.calls.some(call => JSON.stringify(call[1] ?? []).includes(JSON.stringify(id)))).toBe(false);
    });
});
