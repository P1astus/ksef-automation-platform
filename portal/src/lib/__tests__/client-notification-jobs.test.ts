import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobContext } from '../jobs/types';

const sendOffline24Warning = vi.fn(async () => undefined);
const sendReceivablesDigest = vi.fn(async () => undefined);

vi.mock('../email', () => ({ sendOffline24Warning, sendReceivablesDigest }));

function context(rows: any[], shadow = false): JobContext & { query: ReturnType<typeof vi.fn> } {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes('SELECT') ? rows : [{ id: 1 }] }));
    return {
        db: { query }, query,
        now: () => new Date('2026-09-20T10:00:00.000Z'),
        shadow,
        signal: new AbortController().signal,
        alerts: { raise: vi.fn(async () => ({ recorded: true, delivered: true })) },
        log: vi.fn(),
    };
}

describe('client notification jobs', () => {
    beforeEach(() => {
        sendOffline24Warning.mockReset();
        sendReceivablesDigest.mockReset();
    });

    it('declares the required Warsaw schedules', async () => {
        const { clientNotificationsOffline24Job, clientNotificationsReceivablesJob } = await import('../jobs/client-notifications');
        expect(clientNotificationsOffline24Job.schedule).toEqual({ kind: 'cron', expr: '0 */2 * * *', timezone: 'Europe/Warsaw' });
        expect(clientNotificationsReceivablesJob.schedule).toEqual({ kind: 'cron', expr: '0 8 * * 1', timezone: 'Europe/Warsaw' });
        expect(clientNotificationsReceivablesJob.lookbackMinutes).toBeLessThanOrEqual(2880);
    });

    it('uses client_notified_* as the offline warning idempotency boundary', async () => {
        const ctx = context([{
            id: 7, firm_id: 3, client_nip: '1234567890', invoice_number: 'FV/7',
            upload_deadline: '2026-09-20T09:00:00.000Z', client_notified_4h: false,
            client_notified_1h: false, client_notified_overdue: false,
            contact_email: 'client@example.com', client_name: 'Klient',
        }]);
        const { clientNotificationsOffline24Job } = await import('../jobs/client-notifications');
        const result = await clientNotificationsOffline24Job.run(ctx);

        expect(result).toMatchObject({ processed: 1, failures: [] });
        expect(sendOffline24Warning).toHaveBeenCalledOnce();
        const update = ctx.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE offline_invoices'));
        expect(update?.[1]).toEqual([7, 'overdue']);
        expect(String(update?.[0])).toContain('client_notified_overdue');
    });

    it('does not send mail or write flags in shadow mode', async () => {
        const ctx = context([{
            id: 8, firm_id: 3, client_nip: '1234567890', invoice_number: 'FV/8',
            upload_deadline: '2026-09-20T09:00:00.000Z', client_notified_4h: false,
            client_notified_1h: false, client_notified_overdue: false,
            contact_email: 'client@example.com', client_name: 'Klient',
        }], true);
        const { clientNotificationsOffline24Job } = await import('../jobs/client-notifications');
        const result = await clientNotificationsOffline24Job.run(ctx);

        expect(result).toMatchObject({ processed: 1, skipped: 1, failures: [] });
        expect(sendOffline24Warning).not.toHaveBeenCalled();
        expect(ctx.query).toHaveBeenCalledTimes(1);
    });

    it('reports one delivery failure without throwing away the batch', async () => {
        sendReceivablesDigest.mockRejectedValueOnce(new Error('smtp down'));
        const ctx = context([
            { firm_id: 2, client_nip: '1111111111', client_id: 1, contact_email: 'a@example.com', client_name: 'A', invoice_number: 'A/1', gross_amount: '10', due_date: '2026-08-01' },
            { firm_id: 2, client_nip: '2222222222', client_id: 2, contact_email: 'b@example.com', client_name: 'B', invoice_number: 'B/1', gross_amount: '20', due_date: '2026-08-02' },
        ]);
        const { clientNotificationsReceivablesJob } = await import('../jobs/client-notifications');
        const result = await clientNotificationsReceivablesJob.run(ctx);

        expect(sendReceivablesDigest).toHaveBeenCalledTimes(2);
        expect(result.processed).toBe(1);
        expect(result.failures).toEqual([{ subject: 'receivables digest for A', error: 'smtp down', firmId: 2, clientNip: '1111111111' }]);
    });

    it('honours an aborted signal before processing rows', async () => {
        const ctx = context([]);
        const controller = new AbortController();
        controller.abort(new Error('lease lost'));
        ctx.signal = controller.signal;
        const { clientNotificationsOffline24Job } = await import('../jobs/client-notifications');
        await expect(clientNotificationsOffline24Job.run(ctx)).rejects.toThrow('lease lost');
        expect(ctx.query).not.toHaveBeenCalled();
    });
});
