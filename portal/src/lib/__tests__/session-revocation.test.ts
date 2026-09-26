import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { applyCurrentSchema } from './helpers/baseline';

// Session JWTs are stateless and slide forward on every request, so without a
// server-side version a copied cookie stayed valid after the owner changed the
// password, reset it, changed the login e-mail, or logged out. Each of those
// now bumps a per-account session_version that getSession() checks.
// Also covered here: reset tokens are stored hashed and are single use, and
// changing the owner's login e-mail needs the current password.

let db: PGlite;
vi.mock('@/lib/db', () => ({
    query: (text: string, params?: unknown[]) => db.query(text, params as any[]),
    default: { query: (text: string, params?: unknown[]) => db.query(text, params as any[]) },
}));

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
        set: (name: string | { name: string; value: string }, value?: string) => {
            if (typeof name === 'object') jar.set(name.name, name.value);
            else jar.set(name, value ?? '');
        },
    }),
    headers: async () => new Headers(),
}));

const resetUrls: string[] = [];
vi.mock('@/lib/email', () => ({ sendPasswordReset: async (_to: string, url: string) => { resetUrls.push(url); } }));
vi.mock('@/lib/mail-transport', () => ({ assertMailTransportConfigured: () => undefined }));

process.env.JWT_SECRET = 'x'.repeat(64);
process.env.NEXT_PUBLIC_APP_URL = 'https://portal.example';

const OWNER = 'owner@example.test';
const MEMBER = 'member@example.test';

function json(url: string, method: string, body?: unknown) {
    return new Request(`http://localhost${url}`, {
        method, headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.7' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

async function login(email: string, password: string): Promise<string> {
    jar.clear();
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(json('/api/auth/login', 'POST', { email, password }));
    expect(res.status).toBe(200);
    return jar.get('session')!;
}

async function sessionFor(token: string) {
    const { getSession, invalidateFirmActiveCache } = await import('../auth');
    invalidateFirmActiveCache();
    jar.set('session', token);
    return getSession();
}

async function patchSettings(token: string, body: unknown) {
    jar.set('session', token);
    const { PATCH } = await import('@/app/api/settings/route');
    return PATCH(json('/api/settings', 'PATCH', body));
}

beforeAll(async () => {
    db = new PGlite();
    await applyCurrentSchema(db);
});

beforeEach(async () => {
    resetUrls.length = 0;
    await db.exec('DELETE FROM auth_rate_limits; DELETE FROM firm_users; DELETE FROM firms;');
    const firm = await db.query<{ id: number }>(
        `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, subscription_tier, subscription_status, is_active)
         VALUES ('Biuro', 'biuro-' || floor(random()*1e9)::text, $1, $2, 'biznes', 'active', true) RETURNING id`,
        [OWNER, bcrypt.hashSync('owner-pass-1', 4)]
    );
    await db.query(
        `INSERT INTO firm_users (firm_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'M', 'member')`,
        [firm.rows[0].id, MEMBER, bcrypt.hashSync('member-pass-1', 4)]
    );
});

describe('session revocation', () => {
    it('a copied owner cookie stops working after the owner changes the password; the caller stays signed in', async () => {
        const stolen = await login(OWNER, 'owner-pass-1');
        const res = await patchSettings(stolen, { action: 'update_password', current_password: 'owner-pass-1', new_password: 'owner-pass-2' });
        expect(res.status).toBe(200);
        const reissued = jar.get('session')!;
        expect(reissued).not.toBe(stolen);
        expect(await sessionFor(reissued)).not.toBeNull();
        expect(await sessionFor(stolen)).toBeNull();
    });

    it('a copied member cookie stops working after the member changes the password', async () => {
        const stolen = await login(MEMBER, 'member-pass-1');
        const res = await patchSettings(stolen, { action: 'update_password', current_password: 'member-pass-1', new_password: 'member-pass-2' });
        expect(res.status).toBe(200);
        const reissued = jar.get('session')!;
        expect(await sessionFor(stolen)).toBeNull();
        expect(await sessionFor(reissued)).not.toBeNull();
    });

    it('changing the login e-mail needs the current password and revokes older sessions', async () => {
        const token = await login(OWNER, 'owner-pass-1');
        expect((await patchSettings(token, { action: 'update_email', new_email: 'new@example.test' })).status).toBe(400);
        expect((await patchSettings(token, { action: 'update_email', new_email: 'new@example.test', current_password: 'wrong-pass' })).status).toBe(401);
        const ok = await patchSettings(token, { action: 'update_email', new_email: 'new@example.test', current_password: 'owner-pass-1' });
        expect(ok.status).toBe(200);
        const reissued = jar.get('session')!;
        expect((await db.query<{ admin_email: string }>('SELECT admin_email FROM firms')).rows[0].admin_email).toBe('new@example.test');
        expect(await sessionFor(token)).toBeNull();
        expect(await sessionFor(reissued)).not.toBeNull();
    });

    it('logout revokes the token, not just the cookie in this browser', async () => {
        const token = await login(OWNER, 'owner-pass-1');
        jar.set('session', token);
        const { POST } = await import('@/app/api/auth/logout/route');
        expect((await POST()).status).toBe(200);
        expect(await sessionFor(token)).toBeNull();
    });
});

describe('password reset', () => {
    it('stores only a hash of the token, accepts it once, and revokes existing sessions', async () => {
        const token = await login(OWNER, 'owner-pass-1');
        const { POST } = await import('@/app/api/auth/reset-password/route');
        expect((await POST(json('/api/auth/reset-password', 'POST', { action: 'request', email: OWNER }))).status).toBe(200);
        const raw = resetUrls[0].split('/').pop()!;
        const stored = (await db.query<{ reset_token: string }>('SELECT reset_token FROM firms')).rows[0].reset_token;
        expect(stored).toMatch(/^[0-9a-f]{64}$/);
        expect(stored).not.toBe(raw);

        const confirm = () => POST(json('/api/auth/reset-password', 'POST', { action: 'confirm', token: raw, newPassword: 'owner-pass-3' }));
        expect((await confirm()).status).toBe(200);
        expect((await confirm()).status).toBe(400);
        expect(await sessionFor(token)).toBeNull();
        await login(OWNER, 'owner-pass-3');
    });

    it('a member reset revokes the member sessions', async () => {
        const token = await login(MEMBER, 'member-pass-1');
        const { POST } = await import('@/app/api/auth/reset-password/route');
        await POST(json('/api/auth/reset-password', 'POST', { action: 'request', email: MEMBER }));
        const raw = resetUrls[0].split('/').pop()!;
        expect((await POST(json('/api/auth/reset-password', 'POST', { action: 'confirm', token: raw, newPassword: 'member-pass-9' }))).status).toBe(200);
        expect(await sessionFor(token)).toBeNull();
    });
});
