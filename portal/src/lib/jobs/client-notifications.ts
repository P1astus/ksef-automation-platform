import { notifyOffline24 } from '@/lib/notifications/offline24';
import { notifyReceivables } from '@/lib/notifications/receivables';
import type { Job } from './types';

export const clientNotificationsOffline24Job: Job = {
    name: 'client-notifications-offline24',
    schedule: { kind: 'cron', expr: '0 */2 * * *', timezone: 'Europe/Warsaw' },
    timeoutMs: 15 * 60_000,
    maxAttempts: 3,
    lookbackMinutes: 180,
    // IDEMPOTENCY BOUNDARY: offline_invoices.client_notified_* is written only after mail delivery; true skips repeats.
    run: notifyOffline24,
};

export const clientNotificationsReceivablesJob: Job = {
    name: 'client-notifications-receivables',
    schedule: { kind: 'cron', expr: '0 8 * * 1', timezone: 'Europe/Warsaw' },
    timeoutMs: 30 * 60_000,
    maxAttempts: 3,
    lookbackMinutes: 8 * 24 * 60,
    // IDEMPOTENCY BOUNDARY: one durable occurrence per Warsaw week; retries may repeat mail after a crash during send.
    run: notifyReceivables,
};
