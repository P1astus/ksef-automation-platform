import type { Db } from './queue';

export async function loadJobHealth(db: Db, firmId: number | null, limit = 50) {
    const [occurrences, alerts, health] = await Promise.all([
        db.query(
            `SELECT id, job_name, occurrence_key, scheduled_for, state, attempts, max_attempts,
                    started_at, finished_at, last_error, result, shadow, created_at
               FROM job_occurrences
              WHERE $2::int IS NULL OR payload IS NULL OR payload->>'firmId' = $2::text
              ORDER BY scheduled_for DESC, id DESC LIMIT $1`,
            [limit, firmId]
        ),
        firmId === null
            ? db.query(
                `SELECT id, severity, source, firm_id, client_nip, subject, message, created_at,
                        delivered_at, delivery_error
                   FROM system_alerts ORDER BY created_at DESC, id DESC LIMIT $1`,
                [limit]
            )
            : db.query(
                `SELECT id, severity, source, firm_id, client_nip, subject, message, created_at,
                        delivered_at, delivery_error
                   FROM system_alerts
                  WHERE firm_id = $1 OR firm_id IS NULL
                  ORDER BY created_at DESC, id DESC LIMIT $2`,
                [firmId, limit]
            ),
        db.query(
            `SELECT DISTINCT ON (check_type) id, check_type, status, details, checked_at
               FROM system_health ORDER BY check_type, checked_at DESC, id DESC`
        ),
    ]);
    if (firmId !== null) {
        // Global results/errors can contain other clients' NIPs, names and exception details.
        for (const row of occurrences.rows) {
            row.last_error = row.last_error ? 'Blad zadania globalnego; szczegoly dostepne operatorowi' : null;
            row.result = { failures: (row.result?.failures ?? []).filter((f: { firmId?: number }) => f.firmId === firmId) };
        }
        for (const row of alerts.rows) {
            if (row.firm_id == null) {
                row.subject = `Alert systemowy: ${row.source}`;
                row.message = 'Szczegoly alertu globalnego dostepne operatorowi.';
                row.delivery_error = row.delivery_error ? 'Nie udalo sie dostarczyc alertu' : null;
            }
        }
        for (const row of health.rows) row.details = null;
    }
    return { occurrences: occurrences.rows, alerts: alerts.rows, health: health.rows };
}
