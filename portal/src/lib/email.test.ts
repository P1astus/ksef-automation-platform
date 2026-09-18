import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('email delivery', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        process.env.RESEND_API_KEY = 'test-resend-key';
    });

    it('fails rather than pretending to send when the email provider is unconfigured', async () => {
        delete process.env.RESEND_API_KEY;
        const { sendOffline24Warning } = await import('./email');

        await expect(sendOffline24Warning('client@example.com', 'Client', 'FV/1', '2026-09-19T12:00:00Z', '1h'))
            .rejects.toThrow(/resend_api_key/i);
    });

    it('fails when Resend returns a non-success status', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
        const { sendOffline24Warning } = await import('./email');

        await expect(sendOffline24Warning('client@example.com', 'Client', 'FV/1', '2026-09-19T12:00:00Z', '1h'))
            .rejects.toThrow(/http 503/i);
    });
});
