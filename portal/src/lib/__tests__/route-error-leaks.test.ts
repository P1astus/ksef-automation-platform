import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unexpected failures (database, network, third-party SDK) are logged on the
// server and answered with a generic message. Their raw text names internal
// tables, hosts and ports; for IMAP sync it also told a firm admin which
// internal address/port combinations were open.

const INTERNAL = 'relation "secret_table" does not exist at 172.18.0.5:5432';

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1, role: 'owner', userId: null })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/entitlements', () => ({
    requireActiveSubscription: vi.fn(async () => null),
    requireLicenceWrite: vi.fn(async () => null),
}));
vi.mock('@/lib/capability-guard', () => ({ requireBilling: () => null, requireCapability: () => null }));
vi.mock('@/lib/credential-crypto', () => ({
    decryptSecret: () => 'pw', encryptSecret: () => 'enc', clientCredentialContext: (id: unknown) => `ksef-client:${id}`,
    MissingCredentialKeyError: class extends Error {},
}));
vi.mock('imap-simple', () => ({ default: { connect: vi.fn(async () => { throw new Error(`connect ECONNREFUSED ${INTERNAL}`); }) } }));
vi.mock('@/lib/imap-host-policy', () => ({
    resolveImapTarget: async (host: string) => ({ address: '203.0.113.10', servername: host }),
    ImapHostNotAllowedError: class extends Error {},
}));
vi.mock('stripe', () => ({ default: class { customers = { create: async () => { throw new Error(INTERNAL); } }; } }));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
    query: (...a: unknown[]) => queryMock(...a),
    default: { query: (...a: unknown[]) => queryMock(...a), connect: vi.fn() },
}));

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockReset().mockImplementation(async () => { throw new Error(INTERNAL); });
});

async function expectGeneric(res: Response) {
    expect(res.status).toBeGreaterThanOrEqual(500);
    const text = await res.text();
    expect(text).not.toContain('secret_table');
    expect(text).not.toContain('172.18.0.5');
}

const params = { params: Promise.resolve({ id: '1' }) };
const json = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('generic failures do not leak internal error text', () => {
    it('GET /api/invoices', async () => {
        const { GET } = await import('@/app/api/invoices/route');
        await expectGeneric(await GET(new Request('http://localhost/api/invoices')));
    });

    it('GET /api/invoices/[id]/download', async () => {
        const { GET } = await import('@/app/api/invoices/[id]/download/route');
        await expectGeneric(await GET(new Request('http://localhost/x') as any, params));
    });

    it('GET and POST /api/settings/ksef', async () => {
        const { GET, POST } = await import('@/app/api/settings/ksef/route');
        await expectGeneric(await GET(new Request('http://localhost/api/settings/ksef')));
        await expectGeneric(await POST(json('/api/settings/ksef', { client_id: 1, auth_method: 'token', token: 't' })));
    });

    it('POST /api/billing', async () => {
        queryMock.mockImplementation(async () => ({ rows: [{ admin_email: 'a@b.c', firm_name: 'F', stripe_customer_id: null }] }));
        const { POST } = await import('@/app/api/billing/route');
        await expectGeneric(await POST(json('/api/billing', { targetPlan: 'biznes' })));
    });

    it('POST /api/email/sync (IMAP connection failure)', async () => {
        queryMock.mockImplementation(async () => ({ rows: [{ host: 'ksef_db', port: 5432, username: 'u', password_encrypted: 'x', use_tls: false, mailbox: 'INBOX' }] }));
        const { POST } = await import('@/app/api/email/sync/route');
        await expectGeneric(await POST(json('/api/email/sync', {})));
    });
});
