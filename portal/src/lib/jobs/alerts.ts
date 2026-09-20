import type { Db } from './queue';
import type { AlertInput, Alerts } from './types';

// Replaces workflow 01 (the n8n alert bus). Differences that matter:
//   * no hardcoded recipient: ALERT_EMAIL is explicit configuration, and a missing one is RECORDED, not silent
//   * alerts are durable (system_alerts) and visible in the portal, not just an audit_log row and an e-mail
//   * raise() never throws into a job (an alert failure must not mask the failure being reported) but never
//     swallows either: every failure is logged and written onto the alert row.

export interface AlertsDeps {
    db: Db;
    /** Injected: the worker passes lib/mail-transport's sendMail. Absent = e-mail is not configured. */
    sendMail?: (message: { to: string; subject: string; html: string; text: string }) => Promise<void>;
    /** ALERT_EMAIL. No default, by design. */
    alertEmail?: string;
    /** Shadow runs record nothing and send nothing. */
    shadow?: boolean;
    log?: (message: string) => void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createAlerts(deps: AlertsDeps): Alerts {
    const log = deps.log ?? ((m: string) => console.error(m));

    return {
        async raise(alert: AlertInput) {
            if (deps.shadow) {
                log(`[shadow] would raise ${alert.severity} alert from ${alert.source}: ${alert.subject}`);
                return { recorded: false, delivered: false };
            }

            let id: string;
            try {
                const res = await deps.db.query(
                    `INSERT INTO system_alerts (severity, source, firm_id, client_nip, subject, message, details)
                     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
                    [alert.severity, alert.source, alert.firmId ?? null, alert.clientNip ?? null, alert.subject, alert.message,
                        JSON.stringify(alert.details ?? null)]
                );
                id = res.rows[0].id;
                // What workflow 01 also did: the audit trail.
                await deps.db.query(
                    `INSERT INTO audit_log (client_nip, action, workflow_name, details, success, firm_id)
                     VALUES ($1, $2, $3, $4::jsonb, true, $5)`,
                    [alert.clientNip ?? null, `alert_${alert.severity}`, alert.source,
                        JSON.stringify({ subject: alert.subject, message: alert.message, details: alert.details ?? null }), alert.firmId ?? null]
                );
            } catch (err: any) {
                log(`ALERT NOT RECORDED (${alert.severity} from ${alert.source}: ${alert.subject}): ${err?.message ?? err}`);
                return { recorded: false, delivered: false };
            }

            if (alert.severity === 'info') return { recorded: true, delivered: false };

            const failDelivery = async (reason: string) => {
                log(`ALERT NOT DELIVERED (${alert.subject}): ${reason}`);
                try {
                    await deps.db.query('UPDATE system_alerts SET delivery_error = $1 WHERE id = $2::bigint', [reason.slice(0, 1000), id]);
                } catch (err: any) {
                    log(`could not record delivery failure for alert ${id}: ${err?.message ?? err}`);
                }
                return { recorded: true, delivered: false };
            };

            if (!deps.alertEmail) return failDelivery('ALERT_EMAIL is not configured');
            if (!deps.sendMail) return failDelivery('no mail transport is configured');
            try {
                const label = alert.severity === 'critical' ? 'KRYTYCZNY' : 'OSTRZEŻENIE';
                await deps.sendMail({
                    to: deps.alertEmail,
                    subject: `[${label}] ${alert.subject}`,
                    html: `<h3>${esc(alert.subject)}</h3><p>${esc(alert.message)}</p><p style="color:#666">Źródło: ${esc(alert.source)}${alert.clientNip ? ` · NIP ${esc(alert.clientNip)}` : ''}</p>`,
                    text: `${alert.subject}\n\n${alert.message}\n\nŹródło: ${alert.source}${alert.clientNip ? ` · NIP ${alert.clientNip}` : ''}`,
                });
            } catch (err: any) {
                return failDelivery(err?.message ?? String(err));
            }
            try {
                await deps.db.query('UPDATE system_alerts SET delivered_at = NOW() WHERE id = $1::bigint', [id]);
            } catch (err: any) {
                log(`alert ${id} was delivered but could not be marked so: ${err?.message ?? err}`);
            }
            return { recorded: true, delivered: true };
        },
    };
}
