import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { tickOnce, assertRunnerConfig, JobConfigError, type RunnerDeps } from '../jobs/runner';
import { reapExpired, type Db } from '../jobs/queue';
import type { Job, JobResult } from '../jobs/types';

// The runner against a real (PGlite) queue with fake jobs and a controllable clock.

let pg: PGlite;
let db: Db;
let clock: Date;
const advance = (sec: number) => { clock = new Date(clock.getTime() + sec * 1000); };
const T0 = new Date('2026-09-21T10:07:00Z'); // 10:00 is the most recent 15-minute slot

const job = (name: string, run: Job['run'], over: Partial<Job> = {}): Job => ({
    name, schedule: { kind: 'every', minutes: 15 }, timeoutMs: 2000, maxAttempts: 3, run, ...over,
});
const ok = (over: JobResult = {}): Job['run'] => async () => ({ processed: 1, ...over });

const deps = (jobs: Job[], over: Partial<RunnerDeps> = {}): RunnerDeps => ({
    db, jobs, enabled: jobs.map(j => j.name), workerId: 'w1', now: () => clock, leaseSeconds: 60, heartbeatMs: 20,
    alertEmail: 'ops@example.invalid', sendMail: vi.fn().mockResolvedValue(undefined), log: () => {}, ...over,
});
const rows = async () => (await pg.query<any>('SELECT job_name, occurrence_key, state, attempts, last_error, shadow, result FROM job_occurrences ORDER BY id')).rows;
const alertRows = async () => (await pg.query<any>('SELECT severity, source, subject FROM system_alerts ORDER BY id')).rows;

beforeEach(async () => {
    pg = new PGlite();
    await applyCurrentSchema(pg);
    db = { query: (t, p) => pg.query(t, p as any[]) as any };
    clock = new Date(T0);
});

describe('happy path', () => {
    it('enqueues the due occurrence, runs it once, and records the result', async () => {
        const run = vi.fn(ok({ processed: 7 }));
        const s = await tickOnce(deps([job('health', run)]));
        expect(s.enqueued).toEqual(['health@every:2026-09-21T10:00:00.000Z']);
        expect(s.ran).toMatchObject([{ job: 'health', outcome: 'succeeded' }]);
        expect(run).toHaveBeenCalledTimes(1);
        expect((await rows())[0]).toMatchObject({ state: 'succeeded', attempts: 1, result: { processed: 7 } });
    });

    it('re-evaluating the same window on later ticks never runs the same occurrence twice', async () => {
        const run = vi.fn(ok());
        const d = deps([job('health', run)]);
        await tickOnce(d);
        advance(60); await tickOnce(d);
        advance(60); await tickOnce(d);
        expect(run).toHaveBeenCalledTimes(1);
        expect((await rows()).length).toBe(1);
    });

    it('runs the next occurrence when its slot arrives', async () => {
        const run = vi.fn(ok());
        const d = deps([job('health', run)]);
        await tickOnce(d);
        advance(15 * 60); await tickOnce(d);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('a worker restarted after downtime catches up with ONE run, not a storm', async () => {
        const run = vi.fn(ok());
        clock = new Date('2026-09-21T13:07:00Z'); // 3 h of missed slots, lookback is 30 min
        await tickOnce(deps([job('health', run)]));
        expect(run).toHaveBeenCalledTimes(1);
        expect((await rows())[0].occurrence_key).toBe('every:2026-09-21T13:00:00.000Z');
    });
});

describe('an unconfigured worker is inert', () => {
    it('does nothing when no job is enabled', async () => {
        const run = vi.fn(ok());
        const s = await tickOnce(deps([job('health', run)], { enabled: [] }));
        expect(s.ran).toEqual([]);
        expect(run).not.toHaveBeenCalled();
        expect(await rows()).toEqual([]);
    });
    it('only runs the enabled jobs', async () => {
        const a = vi.fn(ok()), b = vi.fn(ok());
        await tickOnce(deps([job('a', a), job('b', b)], { enabled: ['a'] }));
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).not.toHaveBeenCalled();
    });
});

describe('failure handling', () => {
    it('a throwing job is retried after backoff, then succeeds', async () => {
        let calls = 0;
        const d = deps([job('health', async () => { if (++calls === 1) throw new Error('boom'); return { processed: 1 }; })]);
        const first = await tickOnce(d);
        expect(first.ran[0].outcome).toBe('retry');
        expect((await rows())[0]).toMatchObject({ state: 'pending', attempts: 1, last_error: 'boom' });
        expect(await alertRows()).toEqual([]); // no alert for a retryable failure

        advance(30); expect((await tickOnce(d)).ran).toEqual([]); // still inside the 60 s backoff
        advance(40); expect((await tickOnce(d)).ran[0].outcome).toBe('succeeded');
        expect((await rows())[0]).toMatchObject({ state: 'succeeded', attempts: 2 });
    });

    it('exhausting attempts marks the occurrence failed and raises ONE critical alert', async () => {
        const d = deps([job('health', async () => { throw new Error('always'); }, { maxAttempts: 2 })]);
        await tickOnce(d);
        advance(70); const last = await tickOnce(d);
        expect(last.ran[0].outcome).toBe('failed');
        expect((await rows())[0]).toMatchObject({ state: 'failed', attempts: 2 });
        const alerts = await alertRows();
        expect(alerts).toEqual([{ severity: 'critical', source: 'health', subject: 'Job health failed permanently' }]);
        expect(d.sendMail).toHaveBeenCalledTimes(1);
    });

    it('a job that exceeds its timeout is aborted and recorded as a failure (a hung job cannot hold the tick forever)', async () => {
        let sawAbort = false;
        const hang: Job['run'] = ctx => new Promise((_, reject) => { ctx.signal.addEventListener('abort', () => { sawAbort = true; reject(ctx.signal.reason); }); });
        const d = deps([job('slow', hang, { timeoutMs: 40, maxAttempts: 1 })]);
        const s = await tickOnce(d);
        expect(s.ran[0].outcome).toBe('failed');
        expect(sawAbort).toBe(true);
        expect((await rows())[0].last_error).toMatch(/timeout/);
    });

    it('a job that ignores the abort signal still cannot hang the tick or crash the process with an unhandled rejection', async () => {
        const stubborn: Job['run'] = () => new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 120));
        const s = await tickOnce(deps([job('stubborn', stubborn, { timeoutMs: 30, maxAttempts: 1 })]));
        expect(s.ran[0].outcome).toBe('failed');
        await new Promise(r => setTimeout(r, 200)); // let the late rejection fire; vitest fails the run if it is unhandled
    });
});

describe('per-item failures are results, not exceptions', () => {
    it('reports each failed client and a summary, while the occurrence still succeeds', async () => {
        const run = ok({ processed: 5, failures: [
            { subject: 'Client A: auth failed', error: 'HTTP 401', clientNip: '1111111111', firmId: null },
            { subject: 'Client B: query failed', error: 'HTTP 500', clientNip: '2222222222', firmId: null },
        ] });
        const s = await tickOnce(deps([job('retrieval', run)]));
        expect(s.ran[0].outcome).toBe('succeeded');
        const alerts = await alertRows();
        expect(alerts.map(a => a.subject)).toEqual(['Client A: auth failed', 'Client B: query failed', 'retrieval: 2 item(s) failed']);
        expect(alerts.every(a => a.severity === 'warning')).toBe(true);
    });
});

describe('crash and lease recovery', () => {
    it('an occurrence left running by a dead worker is reaped, retried, and completes', async () => {
        const run = vi.fn(ok());
        const d = deps([job('health', run)]);
        // Simulate a worker that claimed the occurrence and died: running, lease already expired.
        await pg.query(`INSERT INTO job_occurrences (job_name, occurrence_key, scheduled_for, state, attempts, lease_expires_at, worker_id)
                        VALUES ('health', 'every:2026-09-21T10:00:00.000Z', $1, 'running', 1, $2, 'dead')`,
            [new Date('2026-09-21T10:00:00Z').toISOString(), new Date(clock.getTime() - 1000).toISOString()]);
        const s = await tickOnce(d);
        expect(s.reaped).toMatchObject([{ job_name: 'health', state: 'pending' }]);
        expect(s.ran[0].outcome).toBe('succeeded');
        expect((await rows())[0]).toMatchObject({ state: 'succeeded', attempts: 2 });
    });

    it('a worker killed on its LAST attempt leaves a permanent failure and a critical alert, not a stranded job', async () => {
        await pg.query(`INSERT INTO job_occurrences (job_name, occurrence_key, scheduled_for, state, attempts, max_attempts, lease_expires_at, worker_id)
                        VALUES ('health', 'every:2026-09-21T10:00:00.000Z', $1, 'running', 3, 3, $2, 'dead')`,
            [new Date('2026-09-21T10:00:00Z').toISOString(), new Date(clock.getTime() - 1000).toISOString()]);
        const s = await tickOnce(deps([job('health', ok())]));
        expect(s.reaped).toMatchObject([{ state: 'failed' }]);
        expect((await alertRows())[0]).toMatchObject({ severity: 'critical', subject: 'Job health failed permanently' });
    });

    it('a job whose lease is taken over mid-run has its result DISCARDED and never overwrites the new owner', async () => {
        const run: Job['run'] = async () => {
            // While we "run", the lease is reaped and another worker takes the occurrence.
            await pg.query(`UPDATE job_occurrences SET worker_id = 'intruder', attempts = attempts + 1 WHERE state = 'running'`);
            return { processed: 99 };
        };
        const s = await tickOnce(deps([job('health', run)]));
        expect(s.ran[0].outcome).toBe('lease-lost');
        const row = (await rows())[0];
        expect(row.state).toBe('running');   // still the intruder's
        expect(row.result).toBeNull();        // our stale result was not written
    });
});

describe('shadow mode is side-effect free', () => {
    it('a shadow-only worker leaves pre-existing real work pending', async () => {
        await pg.query(`INSERT INTO job_occurrences (job_name, occurrence_key, scheduled_for, run_after, shadow)
                        VALUES ('health', 'manual:old', $1, $1, false)`, [T0.toISOString()]);
        const run = vi.fn(ok());
        await tickOnce(deps([job('health', run)], { enabled: [], shadow: ['health'] }));
        expect(run.mock.calls.every(([ctx]) => ctx.shadow)).toBe(true);
        expect((await rows()).find(r => r.occurrence_key === 'manual:old').state).toBe('pending');
    });

    it('recovering an exhausted shadow occurrence never records or mails an alert', async () => {
        await pg.query(`INSERT INTO job_occurrences (job_name, occurrence_key, scheduled_for, state, attempts, max_attempts, lease_expires_at, worker_id, shadow)
                        VALUES ('health', 'shadow:old', $1, 'running', 3, 3, $2, 'dead', true)`,
            [T0.toISOString(), new Date(T0.getTime() - 1000).toISOString()]);
        const d = deps([job('health', ok())], { enabled: [], shadow: ['health'] });
        await tickOnce(d);
        expect(await alertRows()).toEqual([]);
        expect(d.sendMail).not.toHaveBeenCalled();
    });

    it('an inert worker does not reap work or alert', async () => {
        await pg.query(`INSERT INTO job_occurrences (job_name, occurrence_key, scheduled_for, state, attempts, max_attempts, lease_expires_at, worker_id)
                        VALUES ('health', 'old', $1, 'running', 3, 3, $2, 'dead')`,
            [T0.toISOString(), new Date(T0.getTime() - 1000).toISOString()]);
        await tickOnce(deps([job('health', ok())], { enabled: [] }));
        expect((await rows())[0].state).toBe('running');
        expect(await alertRows()).toEqual([]);
    });

    it('runs with ctx.shadow, marks the occurrence shadow, uses a separate key, and sends/records no alert', async () => {
        let seenShadow: boolean | undefined;
        const run: Job['run'] = async ctx => {
            seenShadow = ctx.shadow;
            await ctx.alerts.raise({ severity: 'critical', source: 'offline24', subject: 'would alert a client', message: 'x' });
            return { processed: 3 };
        };
        const d = deps([job('offline24', run)], { enabled: [], shadow: ['offline24'] });
        const s = await tickOnce(d);
        expect(seenShadow).toBe(true);
        expect(s.ran[0]).toMatchObject({ shadow: true, outcome: 'succeeded' });
        const row = (await rows())[0];
        expect(row.shadow).toBe(true);
        expect(row.occurrence_key.startsWith('shadow:')).toBe(true);
        expect(await alertRows()).toEqual([]);
        expect(d.sendMail).not.toHaveBeenCalled();
    });

    it('a shadow run and a real run of the same slot do not collide', async () => {
        await tickOnce(deps([job('a', ok())], { enabled: [], shadow: ['a'] }));
        await tickOnce(deps([job('a', ok())], { enabled: ['a'], shadow: [] }));
        expect((await rows()).map(r => r.occurrence_key.startsWith('shadow:'))).toEqual([true, false]);
    });
});

describe('configuration errors fail loudly', () => {
    const j = [job('a', ok()), job('b', ok())];
    it.each([
        [() => assertRunnerConfig([job('a', ok()), job('a', ok())], [], []), /duplicate job name/],
        [() => assertRunnerConfig(j, ['nope'], []), /unknown job 'nope'/],
        [() => assertRunnerConfig(j, ['a'], ['a']), /both enabled and shadow/],
        [() => assertRunnerConfig([job('a', ok(), { lookbackMinutes: 99999 })], ['a'], []), /lookbackMinutes/],
        [() => assertRunnerConfig([job('a', ok(), { timeoutMs: 0 })], ['a'], []), /timeoutMs/],
        [() => assertRunnerConfig([job('a', ok(), { schedule: { kind: 'cron', expr: 'bad', timezone: 'Europe/Warsaw' } })], ['a'], []), /invalid cron/],
    ])('%#', (call, pattern) => {
        expect(call).toThrow(pattern);
    });
    it('tickOnce refuses to start a misconfigured worker rather than running a subset', async () => {
        await expect(tickOnce(deps(j, { enabled: ['ghost'] }))).rejects.toThrow(JobConfigError);
    });
});
