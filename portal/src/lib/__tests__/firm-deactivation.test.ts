import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

// settings/route.ts's deactivate_account action: proves it's owner-only,
// requires the correct current password, and — when it succeeds — sets
// is_active = false (the same flag auth/login/route.ts already checks and
// rejects on) rather than deleting any data.

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

const logActivityMock = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/activity', () => ({ logActivity: (...args: any[]) => logActivityMock(...args) }));

let sessionOverride: any = { firmId: 1, role: 'owner', userId: null };
vi.mock('@/lib/auth', async () => {
    const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
    return { ...actual, getSession: vi.fn(async () => sessionOverride) };
});

function req(body: object) {
    return new Request('http://localhost/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('settings/route.ts — deactivate_account', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        logActivityMock.mockReset();
        sessionOverride = { firmId: 1, role: 'owner', userId: null };
    });

    it('rejects a non-owner (admin) session', async () => {
        sessionOverride = { firmId: 1, role: 'admin', userId: 5 };
        const { PATCH } = await import('@/app/api/settings/route');
        const res = await PATCH(req({ action: 'deactivate_account', current_password: 'whatever' }));
        expect(res.status).toBe(403);
    });

    it('rejects a missing password', async () => {
        const { PATCH } = await import('@/app/api/settings/route');
        const res = await PATCH(req({ action: 'deactivate_account' }));
        expect(res.status).toBe(400);
    });

    it('rejects the wrong password without deactivating', async () => {
        const hash = await bcrypt.hash('correct-password', 10);
        queryMock.mockResolvedValueOnce({ rows: [{ admin_password_hash: hash, firm_name: 'Firm A' }] });
        const { PATCH } = await import('@/app/api/settings/route');
        const res = await PATCH(req({ action: 'deactivate_account', current_password: 'wrong-password' }));
        expect(res.status).toBe(401);
        expect(queryMock.mock.calls.find(c => String(c[0]).includes('UPDATE firms SET is_active'))).toBeUndefined();
    });

    it('on the correct password: sets is_active = false and logs the deactivation, not a data-deleting query', async () => {
        const hash = await bcrypt.hash('correct-password', 10);
        queryMock.mockResolvedValueOnce({ rows: [{ admin_password_hash: hash, firm_name: 'Firm A' }] });
        queryMock.mockResolvedValueOnce({ rows: [] }); // the UPDATE itself

        const { PATCH } = await import('@/app/api/settings/route');
        const res = await PATCH(req({ action: 'deactivate_account', current_password: 'correct-password' }));
        expect(res.status).toBe(200);

        const updateCall = queryMock.mock.calls.find(c => String(c[0]).includes('UPDATE firms SET is_active'));
        expect(updateCall).toBeDefined();
        expect(String(updateCall![0])).toContain('is_active = false');
        expect(String(updateCall![0])).not.toMatch(/DELETE/i);
        expect(logActivityMock).toHaveBeenCalledWith(1, 'account_deactivated', expect.stringContaining('Firm A'));
    });
});
