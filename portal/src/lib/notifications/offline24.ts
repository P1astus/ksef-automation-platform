import { sendOffline24Warning } from '@/lib/email';
import type { Db } from '@/lib/jobs/queue';
import type { JobFailure, JobResult } from '@/lib/jobs/types';
import { offlineUrgency } from '@/lib/offline-markers';

type OfflineRow = {
    id: number;
    firm_id: number;
    client_nip: string;
    invoice_number: string;
    upload_deadline: string;
    client_notified_4h: boolean;
    client_notified_1h: boolean;
    client_notified_overdue: boolean;
    contact_email: string;
    client_name: string;
};

export interface NotificationRunContext {
    db: Db;
    now: () => Date;
    shadow: boolean;
    signal: AbortSignal;
}

function abortIfNeeded(signal: AbortSignal) {
    if (!signal.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
}

function tierFor(row: OfflineRow, now: Date): '4h' | '1h' | 'overdue' | null {
    const { urgency } = offlineUrgency(row.upload_deadline, now.getTime());
    if (urgency === 'overdue' && !row.client_notified_overdue) return 'overdue';
    if (urgency === 'urgent_1h' && !row.client_notified_1h) return '1h';
    if (urgency === 'urgent_4h' && !row.client_notified_4h) return '4h';
    return null;
}

export async function notifyOffline24(ctx: NotificationRunContext): Promise<JobResult> {
    abortIfNeeded(ctx.signal);
    const pending = await ctx.db.query(
        `SELECT oi.id, oi.firm_id, oi.client_nip, oi.invoice_number, oi.upload_deadline,
                oi.client_notified_4h, oi.client_notified_1h, oi.client_notified_overdue,
                c.contact_email, c.client_name
           FROM offline_invoices oi
           JOIN clients c ON oi.client_nip = c.nip AND oi.firm_id = c.firm_id
          WHERE oi.uploaded_to_ksef = false AND c.contact_email IS NOT NULL
            AND NOT (oi.client_notified_4h AND oi.client_notified_1h AND oi.client_notified_overdue)`
    );

    let processed = 0;
    let skipped = 0;
    const failures: JobFailure[] = [];
    for (const row of pending.rows as OfflineRow[]) {
        abortIfNeeded(ctx.signal);
        const tier = tierFor(row, ctx.now());
        if (!tier) continue;
        if (ctx.shadow) {
            processed++;
            skipped++;
            continue;
        }
        try {
            await sendOffline24Warning(row.contact_email, row.client_name, row.invoice_number, row.upload_deadline, tier);
            abortIfNeeded(ctx.signal);
            // IDEMPOTENCY BOUNDARY: these flags are set only after successful delivery. A retry skips a tier whose flag
            // is already true; a failed delivery leaves it false so a later occurrence can retry it.
            await ctx.db.query(
                `UPDATE offline_invoices
                    SET client_notified_4h = CASE WHEN $2 = '4h' THEN true ELSE client_notified_4h END,
                        client_notified_1h = CASE WHEN $2 = '1h' THEN true ELSE client_notified_1h END,
                        client_notified_overdue = CASE WHEN $2 = 'overdue' THEN true ELSE client_notified_overdue END
                  WHERE id = $1 AND firm_id = $3`,
                [row.id, tier, row.firm_id]
            );
            processed++;
        } catch (error) {
            abortIfNeeded(ctx.signal);
            failures.push({
                subject: `offline24 ${tier} warning for ${row.invoice_number}`,
                error: error instanceof Error ? error.message : String(error),
                firmId: row.firm_id,
                clientNip: row.client_nip,
            });
        }
    }
    return { processed, skipped, failures };
}
