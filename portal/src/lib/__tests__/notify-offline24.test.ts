import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/notify/offline24 — the client-facing counterpart to
// 05-offline24-monitor.json's internal alert_sent_* flags. Proves: the
// urgency thresholds match that workflow's own "Calculate Time Remaining"
// Code node exactly (overdue <=0, urgent_1h <1h, urgent_4h <4h), each tier
// only fires once (its own client_notified_* flag gates it), and the
// shared-secret and email-provider checks fail closed: an inactive or
// misconfigured delivery integration must never mark a legal-deadline alert
// as sent.

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

const sendOffline24WarningMock = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/email', () => ({ sendOffline24Warning: (...args: any[]) => sendOffline24WarningMock(...args) }));

function req(auth?: string) {
    return new Request('http://localhost/api/notify/offline24', {
        method: 'POST',
        headers: { Authorization: auth || 'Bearer right-secret' },
    });
}

describe('POST /api/notify/offline24', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        sendOffline24WarningMock.mockReset();
        process.env.NOTIFY_SECRET = 'right-secret';
        process.env.RESEND_API_KEY = 'test-resend-key';
    });

    it('rejects a wrong secret when NOTIFY_SECRET is set', async () => {
        process.env.NOTIFY_SECRET = 'right-secret';
        const { POST } = await import('@/app/api/notify/offline24/route');
        const res = await POST(req('Bearer wrong'));
        expect(res.status).toBe(401);
    });

    it('fails closed when NOTIFY_SECRET is unset', async () => {
        delete process.env.NOTIFY_SECRET;
        const { POST } = await import('@/app/api/notify/offline24/route');
        const res = await POST(req());
        expect(res.status).toBe(503);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('does not inspect or flag deadlines when the email provider is unconfigured', async () => {
        delete process.env.RESEND_API_KEY;
        const { POST } = await import('@/app/api/notify/offline24/route');
        const res = await POST(req());

        expect(res.status).toBe(503);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('sends an "overdue" warning and sets client_notified_overdue for a past deadline', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 1, invoice_number: 'FV/1', upload_deadline: past, client_notified_4h: false, client_notified_1h: false, client_notified_overdue: false, contact_email: 'c@example.com', client_name: 'Client A' }],
        });
        const { POST } = await import('@/app/api/notify/offline24/route');
        const res = await POST(req());
        const body = await res.json();
        expect(body.sent).toBe(1);
        expect(sendOffline24WarningMock).toHaveBeenCalledWith('c@example.com', 'Client A', 'FV/1', past, 'overdue');
        const updateCall = queryMock.mock.calls.find(c => String(c[0]).includes('UPDATE offline_invoices'));
        expect(String(updateCall![0])).toContain('client_notified_overdue');
    });

    it('sends a "1h" warning for a deadline 30 minutes away, not "4h"', async () => {
        const soon = new Date(Date.now() + 30 * 60_000).toISOString();
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 2, invoice_number: 'FV/2', upload_deadline: soon, client_notified_4h: false, client_notified_1h: false, client_notified_overdue: false, contact_email: 'c@example.com', client_name: 'Client B' }],
        });
        const { POST } = await import('@/app/api/notify/offline24/route');
        await POST(req());
        expect(sendOffline24WarningMock).toHaveBeenCalledWith('c@example.com', 'Client B', 'FV/2', soon, '1h');
    });

    it('sends a "4h" warning for a deadline 3 hours away', async () => {
        const in3h = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 3, invoice_number: 'FV/3', upload_deadline: in3h, client_notified_4h: false, client_notified_1h: false, client_notified_overdue: false, contact_email: 'c@example.com', client_name: 'Client C' }],
        });
        const { POST } = await import('@/app/api/notify/offline24/route');
        await POST(req());
        expect(sendOffline24WarningMock).toHaveBeenCalledWith('c@example.com', 'Client C', 'FV/3', in3h, '4h');
    });

    it('does not re-send a tier that was already notified', async () => {
        const in3h = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 4, invoice_number: 'FV/4', upload_deadline: in3h, client_notified_4h: true, client_notified_1h: false, client_notified_overdue: false, contact_email: 'c@example.com', client_name: 'Client D' }],
        });
        const { POST } = await import('@/app/api/notify/offline24/route');
        const res = await POST(req());
        const body = await res.json();
        expect(body.sent).toBe(0);
        expect(sendOffline24WarningMock).not.toHaveBeenCalled();
    });

    it('does not set a notification flag when delivery fails', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 5, invoice_number: 'FV/5', upload_deadline: past, client_notified_4h: false, client_notified_1h: false, client_notified_overdue: false, contact_email: 'c@example.com', client_name: 'Client E' }],
        });
        sendOffline24WarningMock.mockRejectedValueOnce(new Error('Resend unavailable'));
        const { POST } = await import('@/app/api/notify/offline24/route');
        const res = await POST(req('Bearer right-secret'));

        expect(res.status).toBe(502);
        expect(queryMock.mock.calls.some(c => String(c[0]).includes('UPDATE offline_invoices'))).toBe(false);
    });
});
