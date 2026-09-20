import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { hashSetupToken } from '../setup-token';
import { resetDeploymentCache } from '../deployment';

// POST /api/auth/register in both editions. The hosted branch must be exactly what it was; the local branch is
// closed registration that only the holder of the one-time setup token can open, once.

const h = vi.hoisted(() => ({ db: null as any, createSession: vi.fn(), sendWelcome: vi.fn() }));

vi.mock('@/lib/db', () => ({
    query: (t: string, p?: any[]) => h.db.query(t, p),
    default: { connect: async () => ({ query: (t: string, p?: any[]) => h.db.query(t, p), release: () => {} }) },
}));
vi.mock('@/lib/auth', () => ({ createSession: (...a: unknown[]) => h.createSession(...a) }));
vi.mock('@/lib/email', () => ({ sendWelcome: (...a: unknown[]) => h.sendWelcome(...a) }));

import { POST } from '@/app/api/auth/register/route';

const body = (over: Record<string, unknown> = {}) => new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firm_name: 'Biuro Testowe', admin_email: 'admin@example.invalid', password: 'a-long-password', ...over }),
});
const firms = async () => (await h.db.query('SELECT subscription_tier, subscription_status, trial_expires_at, max_clients FROM firms')).rows;
const seedToken = (raw: string) => h.db.query('INSERT INTO setup_token (token_hash) VALUES ($1)', [hashSetupToken(raw)]);

beforeEach(async () => {
    h.db = new PGlite();
    await applyCurrentSchema(h.db);
    h.createSession.mockReset();
    h.sendWelcome.mockReset().mockResolvedValue(undefined);
    delete process.env.DEPLOYMENT_MODE;
    delete process.env.STRIPE_SECRET_KEY;
    resetDeploymentCache();
});
afterEach(() => {
    delete process.env.DEPLOYMENT_MODE;
    resetDeploymentCache();
});

describe('hosted SaaS (default): unchanged', () => {
    it('opens registration with a 14-day trial on the chosen plan, needs no token, and sends the welcome mail', async () => {
        const res = await POST(body({ plan: 'biznes' }));
        expect(res.status).toBe(200);
        const [f] = await firms();
        expect(f).toMatchObject({ subscription_tier: 'biznes', subscription_status: 'trial', max_clients: 50 });
        expect(f.trial_expires_at).not.toBeNull();
        expect(h.createSession).toHaveBeenCalledTimes(1);
        expect(h.sendWelcome).toHaveBeenCalledTimes(1);
    });

    it('ignores a setup_token entirely and still allows a second firm', async () => {
        await POST(body({ setup_token: 'irrelevant' }));
        const res = await POST(body({ admin_email: 'second@example.invalid', setup_token: 'irrelevant' }));
        expect(res.status).toBe(200);
        expect((await firms()).length).toBe(2);
    });
});

describe('local edition: closed registration', () => {
    beforeEach(() => {
        process.env.DEPLOYMENT_MODE = 'local';
        resetDeploymentCache();
    });

    it('refuses with 403 and no setup token, and creates nothing', async () => {
        const res = await POST(body());
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('SETUP_TOKEN_REQUIRED');
        expect(await firms()).toEqual([]);
        expect(h.createSession).not.toHaveBeenCalled();
    });

    it('refuses a wrong token and does not burn the real one', async () => {
        await seedToken('the-real-token');
        const res = await POST(body({ setup_token: 'guess' }));
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('SETUP_TOKEN_INVALID');
        expect(await firms()).toEqual([]);
        const open = await h.db.query('SELECT 1 FROM setup_token WHERE consumed_at IS NULL');
        expect(open.rows.length).toBe(1);
    });

    it('with the real token: an ACTIVE Pro firm with no trial clock, a session, and no Resend-dependent welcome mail', async () => {
        await seedToken('the-real-token');
        const res = await POST(body({ setup_token: 'the-real-token' }));
        expect(res.status).toBe(200);
        expect((await res.json()).redirectUrl).toBe('/dashboard/onboarding');
        expect(await firms()).toEqual([{ subscription_tier: 'pro', subscription_status: 'active', trial_expires_at: null, max_clients: 999 }]);
        expect(h.createSession).toHaveBeenCalledTimes(1);
        expect(h.sendWelcome).not.toHaveBeenCalled();
    });

    it('a client-chosen plan is ignored: a local firm is always Pro', async () => {
        await seedToken('t');
        await POST(body({ setup_token: 't', plan: 'start' }));
        expect((await firms())[0].subscription_tier).toBe('pro');
    });

    it('after the first firm, first-run is closed even for another valid token', async () => {
        await seedToken('one');
        await POST(body({ setup_token: 'one' }));
        await seedToken('two');
        const res = await POST(body({ admin_email: 'second@example.invalid', setup_token: 'two' }));
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('FIRST_RUN_CLOSED');
        expect((await firms()).length).toBe(1);
    });

    it('field validation still runs first (400, not a token error)', async () => {
        expect((await POST(body({ password: 'short' }))).status).toBe(400);
        expect((await POST(body({ admin_email: 'not-an-email' }))).status).toBe(400);
    });

    it('two simultaneous submissions of the same token: at most one firm is created', async () => {
        await seedToken('race');
        const results = await Promise.allSettled([
            POST(body({ setup_token: 'race' })),
            POST(body({ admin_email: 'b@example.invalid', setup_token: 'race' })),
        ]);
        const statuses = results.map(r => (r.status === 'fulfilled' ? r.value.status : 500));
        expect(statuses.filter(s => s === 200).length).toBe(1);
        expect((await firms()).length).toBe(1);
    });
});
