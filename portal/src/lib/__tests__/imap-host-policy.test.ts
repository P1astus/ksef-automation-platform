import { beforeEach, describe, expect, it, vi } from 'vitest';

// A firm's IMAP settings name a host the portal connects to. That must not
// become a way to reach the platform's own services (database, sidecar, n8n)
// or other internal addresses: hosted installs accept only public addresses on
// the IMAP ports; a local install may use a mail server on its own LAN but
// never loopback, link-local or the stack's internal service names. The sync
// re-checks the address and connects to exactly the checked IP (no DNS
// rebinding between check and connect).

const lookup = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({ default: { lookup }, lookup }));
const deployment = vi.hoisted(() => ({ mode: 'saas' as 'saas' | 'local' }));
vi.mock('@/lib/deployment', async () => {
    const actual = await vi.importActual<typeof import('@/lib/deployment')>('@/lib/deployment');
    return { ...actual, capabilities: () => ({ ...actual.capabilities(), mode: deployment.mode }) };
});

const addresses: Record<string, string[]> = {
    'imap.example.com': ['93.184.216.34'],
    'rebind.example.com': ['93.184.216.34', '10.0.0.8'],
    'mail.office.lan': ['192.168.1.20'],
    'meta.example.com': ['169.254.169.254'],
};

beforeEach(() => {
    deployment.mode = 'saas';
    lookup.mockReset().mockImplementation(async (host: string) => {
        if (/^[\d.]+$/.test(host) || host.includes(':')) return [{ address: host, family: host.includes(':') ? 6 : 4 }];
        const found = addresses[host];
        if (!found) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        return found.map(address => ({ address, family: 4 }));
    });
});

describe('resolveImapTarget', () => {
    it('hosted: accepts a public host on an IMAP port and returns the checked address', async () => {
        const { resolveImapTarget } = await import('../imap-host-policy');
        await expect(resolveImapTarget('imap.example.com', 993)).resolves.toEqual({ address: '93.184.216.34', servername: 'imap.example.com' });
    });

    it.each([
        ['127.0.0.1', 993], ['localhost', 993], ['ksef_db', 5432], ['xades-sidecar', 8090], ['10.1.2.3', 993],
        ['172.18.0.5', 993], ['192.168.1.20', 993], ['169.254.169.254', 993], ['::1', 993], ['fd00::1', 993], ['::ffff:10.0.0.1', 993], ['::ffff:127.0.0.1', 993],
        ['rebind.example.com', 993], ['meta.example.com', 993], ['imap.example.com', 5432], ['0.0.0.0', 993],
    ])('hosted: refuses %s:%s', async (host, port) => {
        const { resolveImapTarget, ImapHostNotAllowedError } = await import('../imap-host-policy');
        await expect(resolveImapTarget(host as string, port as number)).rejects.toBeInstanceOf(ImapHostNotAllowedError);
    });

    it('local: allows a LAN mail server on any port, still refuses loopback, link-local and service names', async () => {
        deployment.mode = 'local';
        const { resolveImapTarget, ImapHostNotAllowedError } = await import('../imap-host-policy');
        await expect(resolveImapTarget('mail.office.lan', 1143)).resolves.toEqual({ address: '192.168.1.20', servername: 'mail.office.lan' });
        for (const host of ['127.0.0.1', 'localhost', 'ksef_db', 'portal', '169.254.169.254', 'meta.example.com']) {
            await expect(resolveImapTarget(host, 993)).rejects.toBeInstanceOf(ImapHostNotAllowedError);
        }
    });
});

describe('IMAP routes enforce the policy', () => {
    vi.mock('@/lib/auth', () => ({
        getSession: vi.fn(async () => ({ firmId: 1, role: 'owner', userId: null })),
        requireRole: vi.fn(async () => null),
    }));
    vi.mock('@/lib/entitlements', () => ({ requireActiveSubscription: vi.fn(async () => null), requireLicenceWrite: vi.fn(async () => null) }));
    vi.mock('@/lib/credential-crypto', () => ({ encryptSecret: () => 'enc', decryptSecret: () => 'pw', MissingCredentialKeyError: class extends Error {} }));
    const queryMock = vi.hoisted(() => vi.fn());
    vi.mock('@/lib/db', () => ({ query: (...a: unknown[]) => queryMock(...a), default: { query: (...a: unknown[]) => queryMock(...a), connect: vi.fn() } }));
    const connect = vi.hoisted(() => vi.fn());
    vi.mock('imap-simple', () => ({ default: { connect } }));

    const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    beforeEach(() => { queryMock.mockReset().mockResolvedValue({ rows: [] }); connect.mockReset(); });

    it('saving settings refuses an internal host and stores nothing', async () => {
        const { POST } = await import('@/app/api/settings/email/route');
        const res = await POST(post('/api/settings/email', { host: 'ksef_db', port: 5432, username: 'u', password: 'p' }));
        expect(res.status).toBe(400);
        expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO firm_imap_settings/.test(String(sql)))).toBe(false);
    });

    it('sync refuses a stored internal host without connecting', async () => {
        queryMock.mockResolvedValue({ rows: [{ host: 'xades-sidecar', port: 8090, username: 'u', password_encrypted: 'x', use_tls: false, mailbox: 'INBOX' }] });
        const { POST } = await import('@/app/api/email/sync/route');
        const res = await POST(post('/api/email/sync', {}));
        expect(res.status).toBe(400);
        expect(connect).not.toHaveBeenCalled();
    });

    it('sync connects to the checked address and keeps the host name for TLS verification', async () => {
        queryMock.mockResolvedValue({ rows: [{ host: 'imap.example.com', port: 993, username: 'u', password_encrypted: 'x', use_tls: true, mailbox: 'INBOX' }] });
        connect.mockRejectedValue(new Error('stop here'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { POST } = await import('@/app/api/email/sync/route');
        await POST(post('/api/email/sync', {}));
        expect(connect).toHaveBeenCalledWith(expect.objectContaining({
            imap: expect.objectContaining({ host: '93.184.216.34', port: 993, tls: true, tlsOptions: expect.objectContaining({ servername: 'imap.example.com' }) }),
        }));
    });
});
