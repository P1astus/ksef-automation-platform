import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));
vi.mock('@/lib/email', () => ({ sendDailyDigest: vi.fn(async () => {}) }));

function req(auth?: string) {
    return new Request('http://localhost/api/digest', {
        method: 'POST',
        headers: auth ? { Authorization: auth } : {},
    });
}

describe('POST /api/digest', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        process.env.DIGEST_SECRET = 'digest-secret';
        process.env.RESEND_API_KEY = 'test-resend-key';
    });

    it('fails closed when DIGEST_SECRET is missing', async () => {
        delete process.env.DIGEST_SECRET;
        const { POST } = await import('@/app/api/digest/route');
        const res = await POST(req());

        expect(res.status).toBe(503);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('rejects an incorrect shared secret', async () => {
        const { POST } = await import('@/app/api/digest/route');
        const res = await POST(req('Bearer wrong'));

        expect(res.status).toBe(401);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('refuses to report a digest as sent when no email provider is configured', async () => {
        delete process.env.RESEND_API_KEY;
        const { POST } = await import('@/app/api/digest/route');
        const res = await POST(req('Bearer digest-secret'));

        expect(res.status).toBe(503);
        expect(queryMock).not.toHaveBeenCalled();
    });
});
