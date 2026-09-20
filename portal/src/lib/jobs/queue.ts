// Durable job queue over Postgres. Replaces n8n's scheduler. No Next.js imports and no direct pool import: every
// function takes a `Db`, so the same code runs in the worker (real pool) and in tests (PGlite).
//
// SQL here is parameterized ONLY. A test scans lib/jobs for interpolated SQL.
//
// Guarantees:
//   * an occurrence (job_name, occurrence_key) is enqueued at most once            UNIQUE constraint
//   * at most one occurrence of a job is `running`                                 partial unique index
//   * a crashed or hung worker's occurrence is recovered, not stranded             lease + reapExpired()
//   * a worker that lost its lease cannot record a result over someone else's run  worker_id checks

export interface Db {
    query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export type OccurrenceState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface Occurrence {
    id: string; // BIGSERIAL: node-postgres returns bigint as a string
    job_name: string;
    occurrence_key: string;
    scheduled_for: Date | string;
    state: OccurrenceState;
    attempts: number;
    max_attempts: number;
    shadow: boolean;
    /** Per-occurrence input (a manual run for one client); null for scheduled runs. */
    payload: unknown | null;
}

const iso = (d: Date) => d.toISOString();

/** Exponential backoff: 60 s, 120 s, 240 s ... capped at 15 minutes. */
export function backoffSeconds(attempt: number): number {
    return Math.min(60 * 2 ** Math.max(0, attempt - 1), 15 * 60);
}

export async function enqueue(
    db: Db,
    o: { jobName: string; occurrenceKey: string; scheduledFor: Date; maxAttempts?: number; shadow?: boolean; payload?: unknown }
): Promise<boolean> {
    const res = await db.query(
        `INSERT INTO job_occurrences (job_name, occurrence_key, scheduled_for, run_after, max_attempts, shadow, payload)
         VALUES ($1, $2, $3, $3, $4, $5, $6::jsonb)
         ON CONFLICT (job_name, occurrence_key) DO NOTHING
         RETURNING id`,
        [o.jobName, o.occurrenceKey, iso(o.scheduledFor), o.maxAttempts ?? 3, o.shadow ?? false, o.payload === undefined ? null : JSON.stringify(o.payload)]
    );
    return res.rows.length > 0;
}

/**
 * Recover occurrences whose lease expired (the worker died or hung). Retryable ones go back to `pending`; ones that
 * have used all their attempts become `failed`. Run this BEFORE claim(): the partial unique index means a stale
 * `running` row would otherwise block its job forever.
 */
export async function reapExpired(db: Db, now: Date): Promise<{ id: string; job_name: string; state: OccurrenceState; attempts: number }[]> {
    const res = await db.query(
        `UPDATE job_occurrences
            SET state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
                last_error = 'lease expired: the worker died or hung mid-run',
                run_after = $1,
                lease_expires_at = NULL,
                worker_id = NULL,
                finished_at = CASE WHEN attempts >= max_attempts THEN $1::timestamptz ELSE NULL END
          WHERE state = 'running' AND lease_expires_at < $1
          RETURNING id, job_name, state, attempts`,
        [iso(now)]
    );
    return res.rows;
}

/** Claim the oldest due occurrence of an enabled job whose job is not already running. Null when nothing is claimable. */
export async function claim(
    db: Db,
    o: { workerId: string; now: Date; leaseSeconds: number; jobNames: string[] }
): Promise<Occurrence | null> {
    if (o.jobNames.length === 0) return null;
    try {
        const res = await db.query(
            `WITH candidate AS (
                 SELECT c.id FROM job_occurrences c
                  WHERE c.state = 'pending' AND c.run_after <= $1 AND c.job_name = ANY($3::text[])
                    AND NOT EXISTS (SELECT 1 FROM job_occurrences r WHERE r.job_name = c.job_name AND r.state = 'running')
                  ORDER BY c.scheduled_for, c.id
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1)
             UPDATE job_occurrences j
                SET state = 'running',
                    attempts = j.attempts + 1,
                    lease_expires_at = $1::timestamptz + ($2::int * INTERVAL '1 second'),
                    worker_id = $4,
                    started_at = COALESCE(j.started_at, $1::timestamptz),
                    last_error = NULL
               FROM candidate
              WHERE j.id = candidate.id
              RETURNING j.id, j.job_name, j.occurrence_key, j.scheduled_for, j.state, j.attempts, j.max_attempts, j.shadow, j.payload`,
            [iso(o.now), o.leaseSeconds, o.jobNames, o.workerId]
        );
        return res.rows[0] ?? null;
    } catch (err: any) {
        // Lost a race: another worker started an occurrence of the same job between our check and our update. The
        // unique index rejected us, which is the point of it. Nothing to do this tick.
        if (err?.code === '23505') return null;
        throw err;
    }
}

/** Extend the lease. false = the lease was lost (reaped and reclaimed): the caller must stop and record nothing. */
export async function heartbeat(db: Db, o: { id: string; workerId: string; now: Date; leaseSeconds: number }): Promise<boolean> {
    const res = await db.query(
        `UPDATE job_occurrences
            SET lease_expires_at = $1::timestamptz + ($2::int * INTERVAL '1 second')
          WHERE id = $3::bigint AND state = 'running' AND worker_id = $4
          RETURNING id`,
        [iso(o.now), o.leaseSeconds, o.id, o.workerId]
    );
    return res.rows.length > 0;
}

export async function complete(db: Db, o: { id: string; workerId: string; now: Date; result: unknown }): Promise<boolean> {
    const res = await db.query(
        `UPDATE job_occurrences
            SET state = 'succeeded', finished_at = $1, lease_expires_at = NULL, result = $2::jsonb
          WHERE id = $3::bigint AND state = 'running' AND worker_id = $4
          RETURNING id`,
        [iso(o.now), JSON.stringify(o.result ?? null), o.id, o.workerId]
    );
    return res.rows.length > 0;
}

export async function skip(db: Db, o: { id: string; workerId: string; now: Date; reason: string }): Promise<boolean> {
    const res = await db.query(
        `UPDATE job_occurrences
            SET state = 'skipped', finished_at = $1, lease_expires_at = NULL, last_error = $2
          WHERE id = $3::bigint AND state = 'running' AND worker_id = $4
          RETURNING id`,
        [iso(o.now), o.reason, o.id, o.workerId]
    );
    return res.rows.length > 0;
}

/**
 * Record a failure of the attempt in `occ` (the row returned by claim()). Retries with backoff until max_attempts, then
 * `failed`. Returns what happened so the caller can alert on exhaustion.
 */
export async function fail(
    db: Db,
    o: { occ: Pick<Occurrence, 'id' | 'attempts' | 'max_attempts'>; workerId: string; now: Date; error: string }
): Promise<{ recorded: boolean; exhausted: boolean; retryAt: Date | null }> {
    const exhausted = o.occ.attempts >= o.occ.max_attempts;
    const retryAt = exhausted ? null : new Date(o.now.getTime() + backoffSeconds(o.occ.attempts) * 1000);
    const res = await db.query(
        `UPDATE job_occurrences
            SET state = $1, last_error = $2, lease_expires_at = NULL, worker_id = NULL,
                run_after = COALESCE($3::timestamptz, run_after),
                finished_at = CASE WHEN $1 = 'failed' THEN $4::timestamptz ELSE NULL END
          WHERE id = $5::bigint AND state = 'running' AND worker_id = $6
          RETURNING id`,
        [exhausted ? 'failed' : 'pending', o.error.slice(0, 4000), retryAt ? iso(retryAt) : null, iso(o.now), o.occ.id, o.workerId]
    );
    return { recorded: res.rows.length > 0, exhausted, retryAt };
}

/** Retention: drop finished occurrences older than `days`. Returns how many. */
export async function prune(db: Db, o: { now: Date; days: number }): Promise<number> {
    const res = await db.query(
        `DELETE FROM job_occurrences
          WHERE state IN ('succeeded', 'skipped', 'failed')
            AND finished_at < $1::timestamptz - ($2::int * INTERVAL '1 day')
          RETURNING id`,
        [iso(o.now), o.days]
    );
    return res.rows.length;
}

export async function recentOccurrences(db: Db, limit = 50) {
    const res = await db.query(
        `SELECT id, job_name, occurrence_key, scheduled_for, state, attempts, last_error, finished_at, shadow
           FROM job_occurrences ORDER BY scheduled_for DESC, id DESC LIMIT $1`,
        [limit]
    );
    return res.rows;
}
