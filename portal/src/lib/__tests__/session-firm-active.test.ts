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

async function token(firmId: number, userId: number | null = 7) {
    return new SignJWT({ firmId, role: userId === null ? 'owner' : 'member', userId })
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
        queryMock.mockImplementation((sql: string) => Promise.resolve({ rows: /FROM firm_users/.test(sql)
            ? [{ id: 7, role: 'member' }]
            : [{ is_active: true, subscription_tier: 'biznes' }] }));
        const { getSession } = await import('@/lib/auth');
        expect((await getSession())?.firmId).toBe(1);
    });

    it('rejects a member immediately after their team row is removed', async () => {
        queryMock.mockImplementation((sql: string) => Promise.resolve({ rows: /FROM firm_users/.test(sql)
            ? []
            : [{ is_active: true, subscription_tier: 'biznes' }] }));
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });

    it('returns null for a deactivated firm', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: false, subscription_tier: 'biznes' }] });
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });

    it('returns null when the firm row is gone', async () => {
        queryMock.mockResolvedValue({ rows: [] });
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });

    it('caches within the TTL, re-checks after it', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true, subscription_tier: 'biznes' }] });
        const { getSession } = await import('@/lib/auth');
        await getSession(); await getSession();
        // Firm access stays cached; a live member row is intentionally
        // checked on every request so removal takes effect immediately.
        expect(queryMock).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(31_000);
        queryMock.mockResolvedValue({ rows: [{ is_active: false, subscription_tier: 'biznes' }] });
        expect(await getSession()).toBeNull();
        expect(queryMock).toHaveBeenCalledTimes(4);
    });

    it('invalidateFirmActiveCache makes deactivation take effect immediately', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true, subscription_tier: 'biznes' }] });
        const { getSession, invalidateFirmActiveCache } = await import('@/lib/auth');
        expect(await getSession()).not.toBeNull();
        queryMock.mockResolvedValue({ rows: [{ is_active: false, subscription_tier: 'biznes' }] });
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

    // Round 14: team seats are a Biznes+ feature, enforced on existing sessions.
    it('rejects an invited member once the firm is on a plan without team seats', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true, subscription_tier: 'start' }] });
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });

    it('never locks out the firm owner over the team feature', async () => {
        cookieValue = await token(1, null);
        queryMock.mockResolvedValue({ rows: [{ is_active: true, subscription_tier: 'start' }] });
        const { getSession } = await import('@/lib/auth');
        expect((await getSession())?.firmId).toBe(1);
    });

    it('fails closed for a member when the tier is unrecognised', async () => {
        queryMock.mockResolvedValue({ rows: [{ is_active: true, subscription_tier: 'gold' }] });
        const { getSession } = await import('@/lib/auth');
        expect(await getSession()).toBeNull();
    });
});
