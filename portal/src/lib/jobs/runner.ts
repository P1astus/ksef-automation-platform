import { Db, claim, complete, enqueue, fail, heartbeat, reapExpired, type Occurrence } from './queue';
import { latestDue, validateSchedule } from './schedule';
import { createAlerts, type AlertsDeps } from './alerts';
import type { Job, JobContext } from './types';

// One scheduler tick: recover dead leases -> enqueue what is due -> claim and run. Pure orchestration over the queue;
// the worker process (src/worker/main.ts) just calls tickOnce() in a loop. The scheduler's try/catch here is the ONLY
// place job failures are caught: job bodies never swallow errors.

export class JobConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'JobConfigError';
    }
}
class JobTimeoutError extends Error {
    constructor(ms: number) {
        super(`job exceeded its ${ms} ms timeout`);
        this.name = 'JobTimeoutError';
    }
}
class LeaseLostError extends Error {
    constructor() {
        super('the lease was lost (reaped and reclaimed): result discarded');
        this.name = 'LeaseLostError';
    }
}

export interface RunnerDeps {
    db: Db;
    jobs: Job[];
    /** Job names that run for real. Default is none: an unconfigured worker is inert, never surprising. */
    enabled: string[];
    /** Job names that run in shadow mode (compute and record, write nothing else). */
    shadow?: string[];
    workerId: string;
    now?: () => Date;
    leaseSeconds?: number;
    heartbeatMs?: number;
    /** Upper bound on occurrences run per tick, so one tick cannot monopolise the worker. */
    maxPerTick?: number;
    sendMail?: AlertsDeps['sendMail'];
    alertEmail?: string;
    log?: (message: string) => void;
}

export interface TickSummary {
    reaped: { id: string; job_name: string; state: string }[];
    enqueued: string[];
    ran: { job: string; occurrenceKey: string; shadow: boolean; outcome: 'succeeded' | 'retry' | 'failed' | 'lease-lost' }[];
}

const MAX_LOOKBACK_MINUTES = 2880; // finished occurrences are pruned after >= 7 days; a lookback must stay well inside that

export function assertRunnerConfig(jobs: Job[], enabled: string[], shadow: string[]): void {
    const names = new Set<string>();
    for (const j of jobs) {
        if (names.has(j.name)) throw new JobConfigError(`duplicate job name '${j.name}'`);
        names.add(j.name);
    }
    for (const n of [...enabled, ...shadow]) {
        if (!names.has(n)) throw new JobConfigError(`unknown job '${n}' (known: ${[...names].join(', ') || 'none'})`);
    }
    for (const n of enabled) {
        if (shadow.includes(n)) throw new JobConfigError(`job '${n}' cannot be both enabled and shadow`);
    }
    for (const j of jobs.filter(x => enabled.includes(x.name) || shadow.includes(x.name))) {
        validateSchedule(j.schedule);
        if ((j.lookbackMinutes ?? 30) > MAX_LOOKBACK_MINUTES) throw new JobConfigError(`job '${j.name}' lookbackMinutes exceeds ${MAX_LOOKBACK_MINUTES}`);
        if (!(j.timeoutMs > 0)) throw new JobConfigError(`job '${j.name}' needs a positive timeoutMs`);
    }
}

export async function tickOnce(deps: RunnerDeps): Promise<TickSummary> {
    const now = deps.now ?? (() => new Date());
    const log = deps.log ?? ((m: string) => console.log(`[jobs] ${m}`));
    const shadow = deps.shadow ?? [];
    const leaseSeconds = deps.leaseSeconds ?? 300;
    assertRunnerConfig(deps.jobs, deps.enabled, shadow);

    const summary: TickSummary = { reaped: [], enqueued: [], ran: [] };
    const alertsFor = (isShadow: boolean) => createAlerts({ db: deps.db, sendMail: deps.sendMail, alertEmail: deps.alertEmail, shadow: isShadow, log });

    // 1. Recover occurrences whose worker died or hung. Must precede claim(): a stale `running` row blocks its job.
    const reaped = await reapExpired(deps.db, now(), { enabled: deps.enabled, shadow });
    summary.reaped = reaped;
    for (const r of reaped) {
        log(`recovered ${r.job_name} #${r.id}: ${r.state === 'failed' ? 'attempts exhausted' : 'will retry'}`);
        if (r.state === 'failed') {
            await alertsFor(r.shadow).raise({
                severity: 'critical', source: r.job_name, subject: `Job ${r.job_name} failed permanently`,
                message: `Occurrence ${r.id} of ${r.job_name} kept losing its worker and used all ${r.attempts} attempts.`,
            });
        }
    }

    // 2. Enqueue what is due. Re-evaluating the same lookback window every tick is safe: (job, occurrence_key) is
    //    unique, so a repeat is a no-op and a restart simply catches up.
    for (const job of deps.jobs) {
        const isShadow = shadow.includes(job.name);
        if (!isShadow && !deps.enabled.includes(job.name)) continue;
        const t = now();
        const due = latestDue(job.schedule, new Date(t.getTime() - (job.lookbackMinutes ?? 30) * 60_000), t);
        if (!due) continue;
        const key = isShadow ? `shadow:${due.occurrenceKey}` : due.occurrenceKey;
        const inserted = await enqueue(deps.db, { jobName: job.name, occurrenceKey: key, scheduledFor: due.scheduledFor, maxAttempts: job.maxAttempts ?? 3, shadow: isShadow });
        if (inserted) summary.enqueued.push(`${job.name}@${key}`);
    }

    // 3. Claim and run, oldest first, bounded per tick.
    const claimable = [...deps.enabled, ...shadow];
    for (let i = 0; i < (deps.maxPerTick ?? 20); i++) {
        const occ = await claim(deps.db, { workerId: deps.workerId, now: now(), leaseSeconds, jobNames: claimable, shadowJobs: shadow });
        if (!occ) break;
        const job = deps.jobs.find(j => j.name === occ.job_name)!;
        summary.ran.push(await execute(deps, job, occ, alertsFor(occ.shadow), now, log, leaseSeconds));
    }
    return summary;
}

async function execute(
    deps: RunnerDeps, job: Job, occ: Occurrence, alerts: ReturnType<typeof createAlerts>,
    now: () => Date, log: (m: string) => void, leaseSeconds: number
): Promise<TickSummary['ran'][number]> {
    const base = { job: job.name, occurrenceKey: occ.occurrence_key, shadow: occ.shadow };
    const controller = new AbortController();
    const ctx: JobContext = { db: deps.db, now, scheduledFor: occ.scheduled_for, shadow: occ.shadow, payload: occ.payload ?? null, signal: controller.signal, alerts, log: m => log(`${job.name}: ${m}`) };

    // The lease is extended while the job runs; if extending it fails the job no longer owns this occurrence.
    const hb = setInterval(async () => {
        try {
            if (!(await heartbeat(deps.db, { id: occ.id, workerId: deps.workerId, now: now(), leaseSeconds }))) controller.abort(new LeaseLostError());
        } catch (err: any) {
            log(`heartbeat for ${job.name} #${occ.id} failed: ${err?.message ?? err}`);
        }
    }, deps.heartbeatMs ?? Math.max(1000, (leaseSeconds * 1000) / 3));
    const timer = setTimeout(() => controller.abort(new JobTimeoutError(job.timeoutMs)), job.timeoutMs);

    const aborted = new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    aborted.catch(() => {}); // avoid an unhandled rejection when abort fires after the race is already settled

    try {
        const running = job.run(ctx);
        running.catch(() => {}); // a job that loses the race may still reject later; its error is already handled below
        const result = await Promise.race([running, aborted]);

        // Per-item failures are RESULTS, not exceptions: report each, then a summary; the occurrence still succeeded.
        for (const f of result.failures ?? []) {
            await alerts.raise({ severity: 'warning', source: job.name, subject: f.subject, message: f.error, firmId: f.firmId, clientNip: f.clientNip });
        }
        if ((result.failures?.length ?? 0) > 0) {
            await alerts.raise({
                severity: 'warning', source: job.name, subject: `${job.name}: ${result.failures!.length} item(s) failed`,
                message: `Processed ${result.processed ?? 0}, failed ${result.failures!.length}.`, details: result.failures,
            });
        }
        const recorded = await complete(deps.db, { id: occ.id, workerId: deps.workerId, now: now(), result });
        return { ...base, outcome: recorded ? 'succeeded' : 'lease-lost' };
    } catch (err: any) {
        if (err instanceof LeaseLostError) {
            log(`${job.name} #${occ.id}: ${err.message}`);
            return { ...base, outcome: 'lease-lost' };
        }
        const message = err?.message ?? String(err);
        const r = await fail(deps.db, { occ, workerId: deps.workerId, now: now(), error: message });
        if (r.exhausted && r.recorded) {
            await alerts.raise({
                severity: 'critical', source: job.name, subject: `Job ${job.name} failed permanently`,
                message: `After ${occ.attempts} attempt(s): ${message}`, details: { occurrenceKey: occ.occurrence_key },
            });
        }
        log(`${job.name} #${occ.id} attempt ${occ.attempts}/${occ.max_attempts} failed: ${message}`);
        return { ...base, outcome: r.exhausted ? 'failed' : 'retry' };
    } finally {
        clearInterval(hb);
        clearTimeout(timer);
    }
}
