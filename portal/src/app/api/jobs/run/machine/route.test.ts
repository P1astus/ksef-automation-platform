import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), buildJobs: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/jobs/queue', () => ({ enqueue: mocks.enqueue }));
vi.mock('@/lib/jobs/registry', () => ({ buildJobs: mocks.buildJobs }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

function req(secret: string) {
    return new Request('http://localhost/api/jobs/run/machine', {
        method: 'POST', body: JSON.stringify({ jobName: 'health-check' }),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    });
}

describe('POST /api/jobs/run/machine', () => {
    beforeEach(() => {
        process.env.JOB_SECRET = 'correct-secret';
        process.env.JOBS_ENABLED = 'health-check';
        process.env.JOBS_SHADOW = '';
        mocks.enqueue.mockReset().mockResolvedValue(true);
        mocks.buildJobs.mockReset().mockReturnValue([{ name: 'health-check', maxAttempts: 3 }]);
    });

    it.each(['', undefined])('refuses an unconfigured secret (%s) without enqueueing', async (secret) => {
        if (secret === undefined) delete process.env.JOB_SECRET;
        else process.env.JOB_SECRET = secret;
        const { POST } = await import('./route');
        const response = await POST(req(''));
        expect(response.status).toBe(503);
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it('rejects the wrong JOB_SECRET without enqueueing', async () => {
        const { POST } = await import('./route');
        const response = await POST(req('wrong-secret'));
        expect(response.status).toBe(401);
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it('refuses a disabled job instead of leaving a real occurrence stranded', async () => {
        process.env.JOBS_ENABLED = '';
        const { POST } = await import('./route');
        expect((await POST(req('correct-secret'))).status).toBe(503);
        expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it('queues shadow when that is the configured execution mode', async () => {
        process.env.JOBS_ENABLED = '';
        process.env.JOBS_SHADOW = 'health-check';
        const { POST } = await import('./route');
        expect((await POST(req('correct-secret'))).status).toBe(202);
        expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ shadow: true }));
    });

    it('enqueues a manual occurrence with the correct JOB_SECRET', async () => {
        const { POST } = await import('./route');
        const response = await POST(req('correct-secret'));
        expect(response.status).toBe(202);
        expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ occurrenceKey: expect.stringMatching(/^manual:/) }));
    });
});
