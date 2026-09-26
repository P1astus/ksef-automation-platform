import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { applyCurrentSchema } from './helpers/baseline';

// Hosted sign-up and login e-mail changes are only effective once the address
// owner clicks a single-use link: anyone could otherwise register (or move an
// account to) an address they do not control. Only a SHA-256 of the link token
// is stored. The local edition's first account is proven by the setup token.

let db: PGlite;
vi.mock('@/lib/db', () => ({
    query: (text: string, params?: unknown[]) => db.query(text, params as any[]),
    default: { query: (text: string, params?: unknown[]) => db.query(text, params as any[]) },
}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
        set: (n: string | { name: string; value: string }, v?: string) => { typeof n === 'object' ? jar.set(n.name, n.value) : jar.set(n, v ?? ''); },
    }),
    headers: async () => new Headers(),
}));
const mail = vi.hoisted(() => ({ configured: true, sent: [] as { kind: string; to: string; url?: string; other?: string }[] }));
vi.mock('@/lib/mail-transport', () => ({
    assertMailTransportConfigured: () => { if (!mail.configured) throw new Error('not configured'); },
}));
vi.mock('@/lib/email', () => ({
    sendEmailVerification: async (to: string, url: string) => { mail.sent.push({ kind: 'verify', to, url }); },
    sendEmailChangeNotice: async (to: string, other: string) => { mail.sent.push({ kind: 'notice', to, other }); },
    sendWelcome: async (to: string) => { mail.sent.push({ kind: 'welcome', to }); },
    sendPasswordReset: async (to: string, url: string) => { mail.sent.push({ kind: 'reset', to, url }); },
}));

process.env.JWT_SECRET = 'e'.repeat(64);
process.env.NEXT_PUBLIC_APP_URL = 'https://portal.example';

const json = (url: string, method: string, body?: unknown) => new Request(`http://localhost${url}`, {
    method, headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.9' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const tokenOf = (url: string) => url.split('/').pop()!;
const lastVerify = (to: string) => [...mail.sent].reverse().find(m => m.kind === 'verify' && m.to === to)!;

async function register(email: string) {
    const { POST } = await import('@/app/api/auth/register/route');
    return POST(json('/api/auth/register', 'POST', { firm_name: 'Biuro', admin_email: email, password: 'Verify-pass-1', plan: 'biznes' }));
}
async function login(email: string, password = 'Verify-pass-1') {
    jar.clear();
    const { POST } = await import('@/app/api/auth/login/route');
    return POST(json('/api/auth/login', 'POST', { email, password }));
}
async function verify(body: unknown) {
    const { POST } = await import('@/app/api/auth/verify-email/route');
    return POST(json('/api/auth/verify-email', 'POST', body));
}

beforeAll(async () => { db = new PGlite(); await applyCurrentSchema(db); });
beforeEach(async () => {
    mail.configured = true; mail.sent.length = 0; jar.clear();
    await db.exec('DELETE FROM auth_rate_limits; DELETE FROM firm_users; DELETE FROM firms;');
});

describe('hosted sign-up', () => {
    it('creates an unverified account, signs nobody in, and mails a single-use link stored only as a hash', async () => {
        const res = await register('new@example.test');
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ verifyEmail: true });
        expect(jar.get('session')).toBeUndefined();
        const row = (await db.query<any>('SELECT email_verified_at, email_verify_token FROM firms')).rows[0];
        expect(row.email_verified_at).toBeNull();
        const raw = tokenOf(lastVerify('new@example.test').url!);
        expect(row.email_verify_token).toMatch(/^[0-9a-f]{64}$/);
        expect(row.email_verify_token).not.toBe(raw);
    });

    it('refuses to create an account when e-mail cannot be sent', async () => {
        mail.configured = false;
        expect((await register('nomail@example.test')).status).toBe(503);
        expect((await db.query<any>('SELECT count(*)::int AS n FROM firms')).rows[0].n).toBe(0);
    });

    it('login is refused until the link is used, without revealing it for a wrong password', async () => {
        await register('gate@example.test');
        expect((await login('gate@example.test', 'wrong-password')).status).toBe(401);
        const res = await login('gate@example.test');
        expect(res.status).toBe(403);
        expect(await res.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
        expect(jar.get('session')).toBeUndefined();

        const raw = tokenOf(lastVerify('gate@example.test').url!);
        expect((await verify({ action: 'confirm', token: raw })).status).toBe(200);
        expect((await verify({ action: 'confirm', token: raw })).status).toBe(400);
        expect((await login('gate@example.test')).status).toBe(200);
    });

    it('an expired link is refused', async () => {
        await register('late@example.test');
        await db.query("UPDATE firms SET email_verify_expires_at = NOW() - INTERVAL '1 minute'");
        expect((await verify({ action: 'confirm', token: tokenOf(lastVerify('late@example.test').url!) })).status).toBe(400);
    });

    it('resend answers the same for any address and replaces the previous link', async () => {
        await register('again@example.test');
        const first = tokenOf(lastVerify('again@example.test').url!);
        for (const email of ['again@example.test', 'nobody@example.test']) {
            const res = await verify({ action: 'resend', email });
            expect(res.status).toBe(200);
        }
        const second = tokenOf(lastVerify('again@example.test').url!);
        expect(second).not.toBe(first);
        expect(mail.sent.filter(m => m.to === 'nobody@example.test')).toHaveLength(0);
        expect((await verify({ action: 'confirm', token: first })).status).toBe(400);
        expect((await verify({ action: 'confirm', token: second })).status).toBe(200);
    });

    it('a completed password reset also proves the address', async () => {
        await register('reset@example.test');
        const { POST } = await import('@/app/api/auth/reset-password/route');
        await POST(json('/api/auth/reset-password', 'POST', { action: 'request', email: 'reset@example.test' }));
        const raw = tokenOf([...mail.sent].reverse().find(m => m.kind === 'reset')!.url!);
        expect((await POST(json('/api/auth/reset-password', 'POST', { action: 'confirm', token: raw, newPassword: 'Verify-pass-2' }))).status).toBe(200);
        expect((await login('reset@example.test', 'Verify-pass-2')).status).toBe(200);
    });
});

describe('changing the login e-mail', () => {
    async function verifiedOwner(email: string) {
        await db.query(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, subscription_tier, subscription_status, is_active, email_verified_at)
             VALUES ('Biuro', 'b-' || floor(random()*1e9)::text, $1, $2, 'biznes', 'active', true, NOW())`,
            [email, bcrypt.hashSync('Verify-pass-1', 4)]
        );
        const res = await login(email);
        expect(res.status).toBe(200);
        return jar.get('session')!;
    }
    async function changeEmail(session: string, newEmail: string) {
        jar.set('session', session);
        const { PATCH } = await import('@/app/api/settings/route');
        return PATCH(json('/api/settings', 'PATCH', { action: 'update_email', new_email: newEmail, current_password: 'Verify-pass-1' }));
    }

    it('takes effect only after the new address confirms; the old address is told', async () => {
        const session = await verifiedOwner('old@example.test');
        const res = await changeEmail(session, 'new-owner@example.test');
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ pendingVerification: true });
        expect((await db.query<any>('SELECT admin_email, pending_email FROM firms')).rows[0]).toEqual({ admin_email: 'old@example.test', pending_email: 'new-owner@example.test' });
        expect(mail.sent).toContainEqual(expect.objectContaining({ kind: 'notice', to: 'old@example.test', other: 'new-owner@example.test' }));

        const raw = tokenOf(lastVerify('new-owner@example.test').url!);
        expect((await verify({ action: 'confirm', token: raw })).status).toBe(200);
        expect((await db.query<any>('SELECT admin_email, pending_email FROM firms')).rows[0]).toEqual({ admin_email: 'new-owner@example.test', pending_email: null });

        const { getSession, invalidateFirmActiveCache } = await import('../auth');
        invalidateFirmActiveCache();
        jar.set('session', session);
        expect(await getSession()).toBeNull(); // existing sessions end with the change
        expect((await login('new-owner@example.test')).status).toBe(200);
    });

    it('refuses the confirmation if another account took the address meanwhile', async () => {
        const session = await verifiedOwner('first@example.test');
        await changeEmail(session, 'contested@example.test');
        const raw = tokenOf(lastVerify('contested@example.test').url!);
        await db.query(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, email_verified_at) VALUES ('Other', 'o-1', 'contested@example.test', 'x', NOW())`
        );
        expect((await verify({ action: 'confirm', token: raw })).status).toBe(409);
        expect((await db.query<any>("SELECT admin_email FROM firms WHERE slug <> 'o-1'")).rows[0].admin_email).toBe('first@example.test');
    });
});

describe('local edition first run', () => {
    it('the setup-token account is verified immediately', async () => {
        const { insertFirmInTransaction } = await import('../first-run');
        const tx = { query: (t: string, p?: unknown[]) => db.query(t, p as any[]) as any };
        await db.exec('BEGIN');
        await insertFirmInTransaction(tx, { firmName: 'Lokalne', firmNip: null, adminEmail: 'local@example.test', passwordHash: 'h', subscriptionTier: 'pro', maxClients: 999 });
        await db.exec('COMMIT');
        expect((await db.query<any>('SELECT email_verified_at FROM firms')).rows[0].email_verified_at).not.toBeNull();
    });
});
