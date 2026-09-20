import type { Db } from './queue';

export async function loadJobHealth(db: Db, firmId: number | null, limit = 50) {
    const [occurrences, alerts, health] = await Promise.all([
        db.query(
            `SELECT id, job_name, occurrence_key, scheduled_for, state, attempts, max_attempts,
                    started_at, finished_at, last_error, result, shadow, created_at
               FROM job_occurrences
              ORDER BY scheduled_for DESC, id DESC LIMIT $1`,
            [limit]
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
    return { occurrences: occurrences.rows, alerts: alerts.rows, health: health.rows };
}
