import type { Db } from './queue';
import type { Schedule } from './schedule';

export type Severity = 'critical' | 'warning' | 'info';

export interface AlertInput {
    severity: Severity;
    source: string;
    subject: string;
    message: string;
    firmId?: number | null;
    clientNip?: string | null;
    details?: unknown;
}

export interface Alerts {
    raise(alert: AlertInput): Promise<{ recorded: boolean; delivered: boolean }>;
}

/** A per-client (or per-item) failure. These are RESULTS, not exceptions: one bad client must not abort the batch. */
export interface JobFailure {
    subject: string;
    error: string;
    firmId?: number | null;
    clientNip?: string | null;
}

export interface JobResult {
    processed?: number;
    skipped?: number;
    failures?: JobFailure[];
    detail?: unknown;
}

export interface JobContext {
    db: Db;
    now: () => Date;
    /**
     * A shadow run computes and records what it WOULD do and writes nothing else: no markers, no alert flags, no
     * preparation rows, no mail. Jobs MUST honour this; the alerts module already does.
     */
    shadow: boolean;
    /** The occurrence's payload (e.g. which client a manual sync is for); null for scheduled runs. */
    payload?: unknown;
    /** Aborted on timeout or when the lease is lost. Long jobs must check it and stop. */
    signal: AbortSignal;
    alerts: Alerts;
    log: (message: string) => void;
}

/**
 * IDEMPOTENCY BOUNDARY: every job states, in a comment on its definition, exactly what it may safely repeat.
 * An occurrence can run more than once (retry after failure, recovery after a crash), so `run` must be safe to re-run.
 */
export interface Job {
    name: string;
    schedule: Schedule;
    timeoutMs: number;
    maxAttempts?: number;
    /** How far back to look for a missed occurrence after downtime. Default 30. Must stay <= 2880 (prune retention). */
    lookbackMinutes?: number;
    run(ctx: JobContext): Promise<JobResult>;
}
