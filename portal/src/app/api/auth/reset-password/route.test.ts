import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn(), hash: vi.fn(async () => 'new-hash') }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('@/lib/rate-limit', () => ({
    requestIp: () => '192.0.2.1',
    consumeRateLimit: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    rateLimitResponse: vi.fn(),
}));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));

import { POST } from './route';

const request = (body: object) => new Request('http://x/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
});

describe('team-member password reset and dev URL safety', () => {
    beforeEach(() => mocks.query.mockReset());
    afterEach(() => vi.unstubAllEnvs());

    it('resets a firm_users password when the token belongs to a member', async () => {
        mocks.query.mockResolvedValueOnce({ rows: [{ account_type: 'member', id: 44 }] });
        mocks.query.mockResolvedValueOnce({ rows: [] });
        const response = await POST(request({ action: 'confirm', token: 'valid-token', newPassword: 'new-password' }));
        expect(response.status).toBe(200);
        expect(mocks.query).toHaveBeenLastCalledWith(
            expect.stringContaining('UPDATE firm_users SET password_hash'),
            ['new-hash', 44]
        );
    });

    it('returns a reset URL only with the explicit non-production opt-in', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('ALLOW_DEV_RESET_URL', 'true');
        vi.stubEnv('RESEND_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
        mocks.query.mockResolvedValueOnce({ rows: [{ account_type: 'member', id: 44 }] });
        mocks.query.mockResolvedValueOnce({ rows: [] });
        const response = await POST(request({ action: 'request', email: 'member@example.pl' }));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.resetUrl).toMatch(/^http:\/\/localhost:3000\/reset-password\/[0-9a-f]{64}$/);
        expect(mocks.query).toHaveBeenLastCalledWith(
            expect.stringContaining('UPDATE firm_users SET reset_token'),
            expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(Date), 44])
        );
    });
});
