import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// POST /api/clients/[id]/sync - three-way: embedded scheduler -> enqueue; else N8N_SYNC_WEBHOOK_URL; else 503.
// It must never say a sync was queued unless one of the two really was.

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ query: (...a: any[]) => queryMock(...a) }));
vi.mock('@/lib/auth', () => ({
    getSession: async () => ({ firmId: 5, userId: 1, role: 'owner' }),
    requireRole: async () => null,
}));
vi.mock('@/lib/entitlements', () => ({
    loadEntitlements: async () => ({ accessState: 'ok', has: () => false }),
    subscriptionInactiveResponse: () => new Response('inactive', { status: 402 }),
}));
vi.mock('@/lib/activity', () => ({ logActivity: async () => {} }));
vi.mock('@/lib/classify', () => ({ classifyInvoice: async () => null }));

const ENV_KEYS = ['SCHEDULER_ENABLED', 'JOBS_ENABLED', 'N8N_SYNC_WEBHOOK_URL', 'ANTHROPIC_API_KEY'];
const saved: Record<string, string | undefined> = {};
const CLIENT = { id: 9, nip: '1111111111', client_name: 'Klient', ksef_token_encrypted: 'enc' };

async function call() {
    const { POST } = await import('@/app/api/clients/[id]/sync/route');
    return POST(new Request('http://localhost/api/clients/9/sync', { method: 'POST' }), { params: Promise.resolve({ id: '9' }) });
}

beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    vi.resetModules();
    queryMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => sql.includes('FROM clients') ? { rows: [CLIENT] } : { rows: [{ id: '1' }] });
});
afterEach(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    vi.unstubAllGlobals();
});

describe('POST /api/clients/[id]/sync', () => {
    it('embedded scheduler: enqueues a client-scoped invoice-retrieval occurrence and calls no webhook', async () => {
        process.env.SCHEDULER_ENABLED = 'true'; process.env.JOBS_ENABLED = 'invoice-retrieval';
        process.env.N8N_SYNC_WEBHOOK_URL = 'http://n8n.invalid/hook';
        const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
        const res = await call();
        expect(res.status).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
        const insert = queryMock.mock.calls.find(c => String(c[0]).includes('INSERT INTO job_occurrences'))!;
        expect(insert[1][0]).toBe('invoice-retrieval');
        expect(insert[1][1]).toMatch(/^manual:client:9:/);
        expect(JSON.parse(insert[1][5])).toEqual({ clientId: 9, firmId: 5 });   // the firm comes from the session, never the body
    });

    it('scheduler not running the job: falls back to the webhook', async () => {
        process.env.SCHEDULER_ENABLED = 'true'; process.env.JOBS_ENABLED = 'health-check';
        process.env.N8N_SYNC_WEBHOOK_URL = 'http://n8n.invalid/hook';
        const fetchMock = vi.fn(async () => new Response('ok', { status: 200 })); vi.stubGlobal('fetch', fetchMock);
        const res = await call();
        expect(res.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(queryMock.mock.calls.some(c => String(c[0]).includes('INSERT INTO job_occurrences'))).toBe(false);
    });

    it('a webhook that refuses is a 502, not "queued"', async () => {
        process.env.N8N_SYNC_WEBHOOK_URL = 'http://n8n.invalid/hook';
        vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
        expect((await call()).status).toBe(502);
    });

    it('neither configured: 503 and nothing enqueued', async () => {
        const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
        const res = await call();
        expect(res.status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(queryMock.mock.calls.some(c => String(c[0]).includes('INSERT INTO job_occurrences'))).toBe(false);
    });

    it('a failing enqueue is a 502, not "queued"', async () => {
        process.env.SCHEDULER_ENABLED = 'true'; process.env.JOBS_ENABLED = 'invoice-retrieval';
        queryMock.mockImplementation(async (sql: string) => { if (sql.includes('INSERT INTO job_occurrences')) throw new Error('db down'); return { rows: [CLIENT] }; });
        expect((await call()).status).toBe(502);
    });
});
