import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createTransport: vi.fn(),
    sendMail: vi.fn(),
    query: vi.fn(),
}));

vi.mock('nodemailer', () => ({
    default: { createTransport: mocks.createTransport },
}));
vi.mock('@/lib/db', () => ({ query: mocks.query }));

describe('mail transport', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        mocks.createTransport.mockReset();
        mocks.sendMail.mockReset();
        mocks.query.mockReset().mockResolvedValue({ rows: [] });
        mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
        mocks.sendMail.mockResolvedValue({ messageId: 'mail-1' });
    });

    afterEach(() => vi.unstubAllEnvs());

    it('throws explicitly when email delivery is disabled', async () => {
        vi.stubEnv('EMAIL_TRANSPORT', 'none');
        const { sendMail } = await import('./mail-transport');

        await expect(sendMail({ to: 'a@example.test', subject: 'Test', html: '<p>Test</p>' }))
            .rejects.toThrow(/disabled|none/i);
    });

    it('serializes attachments for Resend', async () => {
        vi.stubEnv('EMAIL_TRANSPORT', 'resend');
        vi.stubEnv('RESEND_API_KEY', 'resend-key');
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const { sendMail } = await import('./mail-transport');

        await sendMail({
            to: 'a@example.test',
            subject: 'Report',
            html: '<p>Attached</p>',
            attachments: [{ filename: 'report.csv', content: Buffer.from('a,b\n1,2'), contentType: 'text/csv' }],
        });

        const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
        expect(body.attachments).toEqual([{
            filename: 'report.csv',
            content: Buffer.from('a,b\n1,2').toString('base64'),
            content_type: 'text/csv',
        }]);
    });

    it('sends one real SMTP probe before the first delivery in a process', async () => {
        vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
        vi.stubEnv('SMTP_HOST', 'mail.example.test');
        vi.stubEnv('SMTP_FROM_EMAIL', 'KSeF <portal@example.test>');
        vi.stubEnv('SMTP_CHECK_TO', 'operator@example.test');
        const { sendMail } = await import('./mail-transport');

        await sendMail({ to: 'first@example.test', subject: 'First', html: '<p>First</p>' });
        await sendMail({ to: 'second@example.test', subject: 'Second', html: '<p>Second</p>' });

        expect(mocks.sendMail).toHaveBeenCalledTimes(3);
        expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({
            to: 'operator@example.test',
            subject: expect.stringMatching(/SMTP/i),
        });
        expect(mocks.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO system_health'),
            ['smtp', 'ok', expect.any(String)]
        );
    });

    it('records a failed SMTP probe in system_health and rejects delivery', async () => {
        vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
        vi.stubEnv('SMTP_HOST', 'mail.example.test');
        vi.stubEnv('SMTP_FROM_EMAIL', 'portal@example.test');
        vi.stubEnv('SMTP_CHECK_TO', 'operator@example.test');
        mocks.sendMail.mockRejectedValueOnce(new Error('connection refused'));
        const { sendMail } = await import('./mail-transport');

        await expect(sendMail({ to: 'a@example.test', subject: 'Test', html: '<p>Test</p>' }))
            .rejects.toThrow(/connection refused/i);
        expect(mocks.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO system_health'),
            ['smtp', 'error', expect.stringContaining('connection refused')]
        );
    });
});
