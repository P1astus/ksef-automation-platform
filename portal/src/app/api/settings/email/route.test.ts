import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(), requireRole: vi.fn(), requireActiveSubscription: vi.fn(), query: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession, requireRole: mocks.requireRole }));
vi.mock('@/lib/entitlements', () => ({ requireActiveSubscription: mocks.requireActiveSubscription }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

import { GET, POST } from './route';

describe('/api/settings/email', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.KSEF_CREDENTIALS_KEY = Buffer.alloc(32, 4).toString('base64');
        mocks.getSession.mockResolvedValue({ firmId: 9, role: 'owner' });
        mocks.requireRole.mockResolvedValue(null);
        mocks.requireActiveSubscription.mockResolvedValue(null);
        mocks.query.mockResolvedValue({ rows: [] });
    });

    it('returns only the calling firm settings and never returns the password', async () => {
        mocks.query.mockResolvedValue({ rows: [{ host: 'imap.a.pl', port: 993, username: 'a', use_tls: true, mailbox: 'INBOX', password_encrypted: 'ciphertext' }] });
        const response = await GET();
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('firm_id = $1'), [9]);
        const body = await response.json();
        expect(body).toMatchObject({ configured: true, host: 'imap.a.pl', has_password: true });
        expect(JSON.stringify(body)).not.toContain('ciphertext');
    });

    it('encrypts the password and upserts by session firm_id', async () => {
        const response = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ host: 'imap.a.pl', port: 993, username: 'a', password: 'secret', mailbox: 'INBOX', use_tls: true }) }));
        expect(response.status).toBe(200);
        const upsert = mocks.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO firm_imap_settings'));
        expect(upsert).toBeDefined();
        if (!upsert) throw new Error('missing IMAP upsert');
        expect(upsert[1][0]).toBe(9);
        expect(upsert[1][4]).toMatch(/^enc:v1:/);
        expect(upsert[1][4]).not.toContain('secret');
    });
});
