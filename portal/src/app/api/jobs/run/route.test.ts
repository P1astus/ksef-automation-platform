import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(), getOperatorSession: vi.fn(), enqueue: vi.fn(), buildJobs: vi.fn(), query: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession, sessionRole: (s: any) => s.role ?? 'owner' }));
vi.mock('@/lib/operator-auth', () => ({ getOperatorSession: mocks.getOperatorSession }));
vi.mock('@/lib/jobs/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/lib/jobs/registry', () => ({ buildJobs: mocks.buildJobs }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

function req(origin = 'https://portal.example.pl') {
    return new Request('http://portal:3000/api/jobs/run', {
        method: 'POST', body: JSON.stringify({ jobName: 'health-check' }),
        headers: { 'content-type': 'application/json', origin, host: 'portal.example.pl', 'x-forwarded-proto': 'https', 'sec-fetch-site': origin.includes('evil') ? 'cross-site' : 'same-origin' },
    });
}

describe('POST /api/jobs/run', () => {
    afterEach(() => vi.unstubAllEnvs());
    beforeEach(() => {
        vi.stubEnv('DEPLOYMENT_MODE', 'local');
        vi.stubEnv('JOBS_ENABLED', 'health-check');
        vi.stubEnv('JOBS_SHADOW', '');
        vi.stubEnv('STRIPE_SECRET_KEY', '');
        mocks.getSession.mockReset().mockResolvedValue({ firmId: 1, role: 'owner' });
        mocks.getOperatorSession.mockReset().mockResolvedValue(null);
        mocks.enqueue.mockReset().mockResolvedValue(true);
        mocks.buildJobs.mockReset().mockReturnValue([{ name: 'health-check', maxAttempts: 3 }]);
    });

    it('enqueues a manual occurrence for an owner and never executes the job inline', async () => {
        const { POST } = await import('./route');
        const response = await POST(req());
        expect(response.status).toBe(202);
        expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            jobName: 'health-check', occurrenceKey: expect.stringMatching(/^manual:[0-9a-f-]+$/), shadow: false,
        }));
    });

    it('denies a hosted firm owner permission to run jobs for every tenant', async () => {
        vi.stubEnv('DEPLOYMENT_MODE', 'saas');
        const { POST } = await import('./route');
        expect((await POST(req())).status).toBe(403);
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it('also accepts an authenticated operator session', async () => {
        mocks.getSession.mockResolvedValue(null);
        mocks.getOperatorSession.mockResolvedValue({ operatorId: 3, email: 'ops@example.com' });
        const { POST } = await import('./route');
        expect((await POST(req())).status).toBe(202);
    });

    it('denies a cross-site request before enqueueing', async () => {
        const { POST } = await import('./route');
        const response = await POST(req('https://evil.example'));
        expect(response.status).toBe(403);
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });
});
