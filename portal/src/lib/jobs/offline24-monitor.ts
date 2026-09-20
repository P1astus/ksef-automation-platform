import type { Job, JobFailure, JobResult } from './types';
import { offlineUrgency, type OfflineUrgency } from '../offline-markers';

// Port of workflow 05 (n8n "Offline24 Monitor"): every 2 hours, for each offline invoice not yet uploaded to KSeF:
//   * if the invoice now exists in KSeF for that firm: mark the offline row uploaded and set the JPK marker on the
//     invoice (BFK when uploaded after the deadline, else OFF)
//   * otherwise walk the urgency ladder and raise an internal alert (overdue critical / <1h warning / <4h info), then
//     set the matching alert_sent_* flag - only AFTER the alert was recorded.
//
// Differences from the workflow, all deliberate:
//   * the marker write is scoped by the matched invoice's id AND firm_id (the workflow updated `WHERE ksef_number = $2`
//     with no tenant filter: harmless while ksef_number is globally UNIQUE, a cross-tenant overwrite once two firms can
//     hold the same KSeF number, as buyer and seller can)
//   * "mark uploaded" and "set the marker" are ONE statement, so a crash cannot leave an invoice uploaded with no marker
//   * a failing row is a RESULT (one alert per failure by the runner); it does not stop the other rows
//
// Like the workflow, the alert_sent_* flags are written but never read: an unresolved invoice re-alerts on every run.
// (Kept 1:1 on purpose; whether to alert once per tier is a product decision, see HANDOVER.)
//
// IDEMPOTENCY BOUNDARY: safe to re-run. Marking uploaded is guarded by `uploaded_to_ksef = false`, so a repeat is a
// no-op; a repeat of an alert only sends the same alert again and re-sets the same flag.
// SHADOW: reads and classifies only. No marker, no flag, no alert (the alerts module also refuses in shadow).

const ALERT_FLAG: Record<Exclude<OfflineUrgency, 'ok'>, 'alert_sent_overdue' | 'alert_sent_1h' | 'alert_sent_4h'> = {
    overdue: 'alert_sent_overdue',
    urgent_1h: 'alert_sent_1h',
    urgent_4h: 'alert_sent_4h',
};

// Column names above are a closed set chosen from the ladder, never user input; SQL text below is a fixed literal per key.
const FLAG_SQL = {
    alert_sent_overdue: 'UPDATE offline_invoices SET alert_sent_overdue = true, updated_at = NOW() WHERE id = $1 AND firm_id = $2',
    alert_sent_1h: 'UPDATE offline_invoices SET alert_sent_1h = true, updated_at = NOW() WHERE id = $1 AND firm_id = $2',
    alert_sent_4h: 'UPDATE offline_invoices SET alert_sent_4h = true, updated_at = NOW() WHERE id = $1 AND firm_id = $2',
} as const;

// The CASE is offline-markers.ts's rule (a test runs it against offlineMarker()); the cast is load-bearing (round 11).
const MARK_UPLOADED_SQL = `
    WITH o AS (
        UPDATE offline_invoices
           SET uploaded_to_ksef = true, ksef_number = $1, updated_at = NOW()
         WHERE id = $2 AND firm_id = $3 AND uploaded_to_ksef = false
        RETURNING upload_deadline
    )
    UPDATE invoices
       SET jpk_marker = CASE WHEN (SELECT upload_deadline FROM o)::timestamptz < NOW() THEN 'BFK' ELSE 'OFF' END
     WHERE id = $4 AND firm_id = $3 AND EXISTS (SELECT 1 FROM o)
    RETURNING jpk_marker`;

const MESSAGES: Record<Exclude<OfflineUrgency, 'ok'>, { severity: 'critical' | 'warning' | 'info'; text: (n: string, label: string) => string }> = {
    overdue: { severity: 'critical', text: (n, l) => `CRITICAL: Offline24 deadline EXCEEDED for invoice ${n}. ${l}. Immediate upload required!` },
    urgent_1h: { severity: 'warning', text: (n, l) => `WARNING: Less than 1 hour until Offline24 deadline for invoice ${n}. ${l}` },
    urgent_4h: { severity: 'info', text: (n, l) => `INFO: Less than 4 hours until Offline24 deadline for invoice ${n}. ${l}` },
};

export function offline24MonitorJob(): Job {
    return {
        name: 'offline24-monitor',
        schedule: { kind: 'cron', expr: '0 */2 * * *', timezone: 'Europe/Warsaw' },
        timeoutMs: 5 * 60_000,
        maxAttempts: 3,
        lookbackMinutes: 180,
        async run(ctx): Promise<JobResult> {
            const pending = await ctx.db.query(
                `SELECT id, firm_id, invoice_number, client_nip, upload_deadline
                   FROM offline_invoices WHERE uploaded_to_ksef = false ORDER BY upload_deadline ASC`
            );
            const failures: JobFailure[] = [];
            const counts = { found: 0, overdue: 0, urgent_1h: 0, urgent_4h: 0, ok: 0 };
            let processed = 0;

            for (const row of pending.rows) {
                if (ctx.signal.aborted) throw new Error('offline24-monitor aborted (timeout or lost lease)');
                const subject = `offline invoice ${row.invoice_number} (id ${row.id})`;
                const who = { firmId: row.firm_id, clientNip: row.client_nip };
                try {
                    const match = await ctx.db.query(
                        `SELECT id, ksef_number FROM invoices
                          WHERE invoice_number = $1 AND firm_id = $2 AND (seller_nip = $3 OR buyer_nip = $3) AND ksef_number IS NOT NULL
                          LIMIT 1`,
                        [row.invoice_number, row.firm_id, row.client_nip]
                    );
                    const found = match.rows[0];
                    if (found) {
                        counts.found++;
                        if (!ctx.shadow) {
                            await ctx.db.query(MARK_UPLOADED_SQL, [found.ksef_number, row.id, row.firm_id, found.id]);
                        } else {
                            ctx.log(`[shadow] would mark ${subject} uploaded (${found.ksef_number}) and set its JPK marker`);
                        }
                        processed++;
                        continue;
                    }

                    const reading = offlineUrgency(row.upload_deadline, ctx.now().getTime());
                    counts[reading.urgency]++;
                    if (reading.urgency === 'ok') { processed++; continue; }

                    const msg = MESSAGES[reading.urgency];
                    const res = await ctx.alerts.raise({
                        severity: msg.severity, source: 'offline24-monitor',
                        subject: `Offline24: ${reading.urgency === 'overdue' ? 'deadline exceeded' : reading.urgency === 'urgent_1h' ? '< 1 h left' : '< 4 h left'} - ${row.invoice_number}`,
                        message: msg.text(row.invoice_number, reading.label),
                        firmId: row.firm_id, clientNip: row.client_nip,
                        details: { offline_invoice_id: row.id, upload_deadline: row.upload_deadline, urgency: reading.urgency },
                    });
                    if (ctx.shadow) { processed++; continue; }
                    if (!res.recorded) {
                        // The alert was not recorded anywhere: leave the flag unset so the next run tries again.
                        failures.push({ subject, error: `${msg.severity} alert could not be recorded`, ...who });
                        continue;
                    }
                    await ctx.db.query(FLAG_SQL[ALERT_FLAG[reading.urgency]], [row.id, row.firm_id]);
                    processed++;
                } catch (err: any) {
                    failures.push({ subject, error: err?.message ?? String(err), ...who });
                }
            }
            return { processed, failures, detail: { pending: pending.rows.length, ...counts } };
        },
    };
}
