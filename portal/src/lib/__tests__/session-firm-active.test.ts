import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT } from 'jose';

// Round 13: getSession() must reject a JWT-valid session once its firm is
// deactivated (firms.is_active = false), cache the lookup briefly, and fail
// closed if the lookup itself errors.

process.env.JWT_SECRET = 'test-secret-for-session-firm-active';

let cookieValue: string | undefined;
vi.mock('next/headers', () => ({
    cookies: async () => ({ get: (n: string) => (n === 'session' && cookieValue ? { value: cookieValue } : undefined) }),
}));

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({ query: (...a: any[]) => queryMock(...a) }));

async function token(firmId: number) {
    return new SignJWT({ firmId, role: 'member', userId: 7 })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('8h')
        .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}

describe('getSession — firms.is_active enforcement', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        queryMock.mockReset();
        const { invalidateFirmActiveCache } = await import('@/lib/auth');
        invalidateFirmActiveCache();
        cookieValue = await token(1);
    });
    afterEach(() => vi.useRealTimers());

    it('returns the session for an active firm', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true }] });
        const { getSession } = await import('@/lib/auth');
        expect((await getSession())?.firmId).toBe(1);
    });

    it('returns null for a deactivated firm', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: false }] });
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });

    it('returns null when the firm row is gone', async () => {
        queryMock.mockResolvedValue({ rows: [] });
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });

    it('caches within the TTL, re-checks after it', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true }] });
        const { getSession } = await import('@/lib/auth');
        await getSession(); await getSession();
        expect(queryMock).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(31_000);
        queryMock.mockResolvedValue({ rows: [{ is_active: false }] });
        expect(await getSession()).toBeNull();
        expect(queryMock).toHaveBeenCalledTimes(2);
    });

    it('invalidateFirmActiveCache makes deactivation take effect immediately', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true }] });
        const { getSession, invalidateFirmActiveCache } = await import('@/lib/auth');
        expect(await getSession()).not.toBeNull();
        queryMock.mockResolvedValue({ rows: [{ is_active: false }] });
        invalidateFirmActiveCache(1);
        expect(await getSession()).toBeNull();
    });

    it('fails closed (throws, never returns a session) when the lookup errors', async () => {
        queryMock.mockRejectedValue(new Error('db down'));
        const { getSession } = await import('@/lib/auth');
        await expect(getSession()).rejects.toThrow('db down');
    });

    it('getSessionUnchecked never touches the DB', async () => {
        const { getSessionUnchecked } = await import('@/lib/auth');
        expect((await getSessionUnchecked())?.firmId).toBe(1);
        expect(queryMock).not.toHaveBeenCalled();
    });
});
