import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    sendTeamInvite: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth', () => ({
    getSession: async () => ({ firmId: 7, role: 'owner' }),
    requireRole: async () => null,
}));
vi.mock('@/lib/entitlements', () => ({ requireFeature: async () => null }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('@/lib/activity', () => ({ logActivity: async () => undefined }));
vi.mock('@/lib/email', () => ({ sendTeamInvite: mocks.sendTeamInvite }));

import { POST } from './route';

describe('team invitation email', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        mocks.query.mockReset();
        mocks.sendTeamInvite.mockClear();
        mocks.query.mockResolvedValue({ rows: [] });
    });

    it('uses the shared mail transport', async () => {
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.example');
        mocks.query.mockImplementation(async (sql: string) => (
            sql.includes('SELECT firm_name') ? { rows: [{ firm_name: 'Biuro Test' }] } : { rows: [] }
        ));

        const response = await POST(new Request('http://x/api/team', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'member@example.pl', role: 'member' }),
        }));

        expect(response.status).toBe(200);
        expect(mocks.sendTeamInvite).toHaveBeenCalledWith(
            'member@example.pl',
            'Biuro Test',
            expect.stringMatching(/^https:\/\/portal\.example\/invite\/accept\?token=[0-9a-f]{64}$/)
        );
    });
});
