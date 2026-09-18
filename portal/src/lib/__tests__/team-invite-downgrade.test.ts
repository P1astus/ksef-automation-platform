import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

import { GET, POST } from '@/app/api/team/accept/route';

const invitation = {
    id: 41,
    firm_id: 7,
    email: 'member@example.test',
    role: 'member',
    accepted: false,
    subscription_tier: 'start',
    firm_name: 'Downgraded Firm',
};

beforeEach(() => {
    mocks.query.mockReset();
    mocks.query.mockResolvedValue({ rows: [invitation] });
});

describe('invitation acceptance after a plan downgrade', () => {
    it('GET refuses an invitation issued before the firm lost the team feature', async () => {
        const response = await GET(new Request('http://localhost/api/team/accept?token=existing-token'));

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED', feature: 'team' });
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('POST refuses the old invitation before hashing a password or writing a member', async () => {
        const response = await POST(new Request('http://localhost/api/team/accept', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: 'existing-token', fullName: 'Old Invite', password: 'safe-password' }),
        }));

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED', feature: 'team' });
        expect(mocks.query).toHaveBeenCalledTimes(1);
        expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO firm_users|UPDATE invitations/i.test(sql))).toBe(false);
    });
});
