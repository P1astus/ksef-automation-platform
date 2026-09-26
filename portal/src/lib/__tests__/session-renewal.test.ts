import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';

// Middleware renews the session cookie. Renewing on every request let a
// request that was already in flight with an older cookie (typically a Next.js
// prefetch) overwrite a cookie the server had just rotated after a password or
// e-mail change, signing the user out. Renew only in the second half of the
// token's lifetime, and never from a prefetch.
const SECRET = 'r'.repeat(64);
beforeAll(() => { process.env.JWT_SECRET = SECRET; });

async function token(expiresInSeconds: number) {
    return new SignJWT({ firmId: 1, adminEmail: 'o@example.test', role: 'owner', userId: null, sv: 3 })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
        .sign(new TextEncoder().encode(SECRET));
}
const request = (cookie: string, headers: Record<string, string> = {}) =>
    new NextRequest('https://portal.example/dashboard', { headers: { cookie: `session=${cookie}`, ...headers } });
const setCookie = (res: Response | undefined) => res?.headers.get('set-cookie') ?? null;

describe('updateSession()', () => {
    it('leaves a fresh cookie alone', async () => {
        const { updateSession } = await import('../auth');
        expect(setCookie(await updateSession(request(await token(7 * 3600))))).toBeNull();
    });

    it('renews a cookie in the second half of its lifetime, keeping its claims', async () => {
        const { updateSession, decrypt } = await import('../auth');
        const header = setCookie(await updateSession(request(await token(3600))));
        expect(header).toMatch(/^session=/);
        const renewed = await decrypt(/session=([^;]+)/.exec(header!)![1]);
        expect(renewed).toMatchObject({ firmId: 1, sv: 3 });
        expect(renewed.exp * 1000 - Date.now()).toBeGreaterThan(7 * 3600 * 1000);
    });

    it('never renews from a prefetch request', async () => {
        const { updateSession } = await import('../auth');
        const old = await token(3600);
        expect(setCookie(await updateSession(request(old, { 'next-router-prefetch': '1' })))).toBeNull();
        expect(setCookie(await updateSession(request(old, { purpose: 'prefetch' })))).toBeNull();
    });

    it('still clears a tampered cookie', async () => {
        const { updateSession } = await import('../auth');
        expect(setCookie(await updateSession(request('not-a-jwt')))).toMatch(/session=;/);
    });
});
