import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { applyCurrentSchema } from './helpers/baseline';
import { enqueue, claim, heartbeat, complete, fail, skip, reapExpired, prune, backoffSeconds, recentOccurrences, type Db } from '../jobs/queue';

const T0 = new Date('2026-09-21T10:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const LEASE = 60;

let pg: PGlite;
let db: Db;
const state = async (id: string) => (await pg.query<any>('SELECT state, attempts, worker_id, last_error, run_after FROM job_occurrences WHERE id = $1', [id])).rows[0];

beforeEach(async () => {
    pg = new PGlite();
    await applyCurrentSchema(pg);
    db = { query: (t, p) => pg.query(t, p as any[]) as any };
});

const seed = (job: string, key: string, sec = 0, extra: Partial<{ maxAttempts: number }> = {}) =>
    enqueue(db, { jobName: job, occurrenceKey: key, scheduledFor: at(sec), ...extra });

describe('enqueue', () => {
    it('is idempotent per (job, occurrence key): the same occurrence is never queued twice', async () => {
        expect(await seed('health', 'k1')).toBe(true);
        expect(await seed('health', 'k1')).toBe(false);
        expect(await seed('health', 'k2')).toBe(true);
        expect(await seed('other', 'k1')).toBe(true); // same key, different job
        expect((await pg.query('SELECT count(*)::int AS n FROM job_occurrences')).rows[0]).toEqual({ n: 3 });
    });
});

describe('claim', () => {
    it('claims the oldest due occurrence first, and leases it', async () => {
        await seed('health', 'newer', 30);
        await seed('health', 'older', 0);
        const c = await claim(db, { workerId: 'w1', now: at(60), leaseSeconds: LEASE, jobNames: ['health'] });
        expect(c?.occurrence_key).toBe('older');
        expect(c?.attempts).toBe(1);
        expect(c?.state).toBe('running');
        const row = (await pg.query<any>('SELECT lease_expires_at, worker_id FROM job_occurrences WHERE id = $1', [c!.id])).rows[0];
        expect(new Date(row.lease_expires_at).getTime()).toBe(at(60 + LEASE).getTime());
        expect(row.worker_id).toBe('w1');
    });

    it('does not claim what is not yet due, or jobs that are not enabled', async () => {
        await seed('health', 'future', 300);
        await seed('secret-job', 'due', 0);
        expect(await claim(db, { workerId: 'w', now: at(10), leaseSeconds: LEASE, jobNames: ['health'] })).toBeNull();
        expect(await claim(db, { workerId: 'w', now: at(400), leaseSeconds: LEASE, jobNames: [] })).toBeNull();
        expect((await claim(db, { workerId: 'w', now: at(400), leaseSeconds: LEASE, jobNames: ['health'] }))?.occurrence_key).toBe('future');
    });

    it('never runs two occurrences of the same job at once, but other jobs proceed', async () => {
        await seed('health', 'a', 0);
        await seed('health', 'b', 1);
        await seed('offline24', 'x', 2);
        const first = await claim(db, { workerId: 'w1', now: at(10), leaseSeconds: LEASE, jobNames: ['health', 'offline24'] });
        const second = await claim(db, { workerId: 'w2', now: at(10), leaseSeconds: LEASE, jobNames: ['health', 'offline24'] });
        expect(first?.job_name).toBe('health');
        expect(second?.job_name).toBe('offline24'); // health/b is blocked while health/a runs
        expect(await claim(db, { workerId: 'w3', now: at(10), leaseSeconds: LEASE, jobNames: ['health', 'offline24'] })).toBeNull();
        await complete(db, { id: first!.id, workerId: 'w1', now: at(20), result: {} });
        expect((await claim(db, { workerId: 'w3', now: at(20), leaseSeconds: LEASE, jobNames: ['health'] }))?.occurrence_key).toBe('b');
    });

    it('the database itself refuses a second running occurrence of a job (the guarantee is not just a convention)', async () => {
        await seed('health', 'a');
        await seed('health', 'b', 1);
        await pg.exec(`UPDATE job_occurrences SET state = 'running' WHERE occurrence_key = 'a'`);
        await expect(pg.exec(`UPDATE job_occurrences SET state = 'running' WHERE occurrence_key = 'b'`)).rejects.toMatchObject({ code: '23505' });
    });

    it('a lost claim race is not an error: the unique index rejects it and claim returns null', async () => {
        await seed('health', 'a');
        // Simulate the race: the NOT EXISTS pre-check passes but the index catches a concurrent winner.
        const racing: Db = { query: async () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }); } };
        expect(await claim(racing, { workerId: 'w', now: at(1), leaseSeconds: LEASE, jobNames: ['health'] })).toBeNull();
    });

    it('rethrows unexpected database errors instead of hiding them', async () => {
        const broken: Db = { query: async () => { throw Object.assign(new Error('connection lost'), { code: '08006' }); } };
        await expect(claim(broken, { workerId: 'w', now: at(1), leaseSeconds: LEASE, jobNames: ['health'] })).rejects.toThrow('connection lost');
    });
});

describe('crash recovery (lease + reapExpired)', () => {
    it('a worker that dies mid-run is recovered: the occurrence goes back to pending and is claimable again', async () => {
        await seed('health', 'a');
        const c = await claim(db, { workerId: 'dead', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        // Before the lease expires nothing is reaped, and nothing else can claim it.
        expect(await reapExpired(db, at(30))).toEqual([]);
        expect(await claim(db, { workerId: 'w2', now: at(30), leaseSeconds: LEASE, jobNames: ['health'] })).toBeNull();

        const reaped = await reapExpired(db, at(LEASE + 1));
        expect(reaped).toMatchObject([{ id: c!.id, state: 'pending', attempts: 1 }]);
        const again = await claim(db, { workerId: 'w2', now: at(LEASE + 2), leaseSeconds: LEASE, jobNames: ['health'] });
        expect(again?.id).toBe(c!.id);
        expect(again?.attempts).toBe(2);
    });

    it('an occurrence that keeps killing its worker fails permanently after max_attempts instead of looping forever', async () => {
        await seed('health', 'poison', 0, { maxAttempts: 2 });
        for (let i = 0; i < 2; i++) {
            const t = i * 200;
            await claim(db, { workerId: `w${i}`, now: at(t), leaseSeconds: LEASE, jobNames: ['health'] });
            await reapExpired(db, at(t + LEASE + 1));
        }
        const row = (await pg.query<any>(`SELECT state, attempts, last_error FROM job_occurrences`)).rows[0];
        expect(row.state).toBe('failed');
        expect(row.attempts).toBe(2);
        expect(row.last_error).toMatch(/lease expired/);
        expect(await claim(db, { workerId: 'w9', now: at(2000), leaseSeconds: LEASE, jobNames: ['health'] })).toBeNull();
    });

    it('a worker that lost its lease cannot extend it or record a result over the new owner', async () => {
        await seed('health', 'a');
        const c = await claim(db, { workerId: 'old', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        await reapExpired(db, at(LEASE + 1));
        await claim(db, { workerId: 'new', now: at(LEASE + 2), leaseSeconds: LEASE, jobNames: ['health'] });

        expect(await heartbeat(db, { id: c!.id, workerId: 'old', now: at(LEASE + 3), leaseSeconds: LEASE })).toBe(false);
        expect(await complete(db, { id: c!.id, workerId: 'old', now: at(LEASE + 3), result: { stale: true } })).toBe(false);
        expect((await state(c!.id)).worker_id).toBe('new');
        expect(await complete(db, { id: c!.id, workerId: 'new', now: at(LEASE + 4), result: { ok: true } })).toBe(true);
    });

    it('heartbeat extends the lease of the live owner', async () => {
        await seed('health', 'a');
        const c = await claim(db, { workerId: 'w', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        expect(await heartbeat(db, { id: c!.id, workerId: 'w', now: at(50), leaseSeconds: LEASE })).toBe(true);
        expect(await reapExpired(db, at(LEASE + 10))).toEqual([]); // would have expired at 60 without the heartbeat
    });
});

describe('fail / retry / skip', () => {
    it('retries with exponential backoff, and only becomes claimable after run_after', async () => {
        expect([1, 2, 3, 4, 5, 6, 7].map(backoffSeconds)).toEqual([60, 120, 240, 480, 900, 900, 900]);
        await seed('health', 'a');
        const c = await claim(db, { workerId: 'w', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        const r = await fail(db, { occ: c!, workerId: 'w', now: at(5), error: 'boom' });
        expect(r).toMatchObject({ recorded: true, exhausted: false });
        expect(r.retryAt!.getTime()).toBe(at(5 + 60).getTime());
        expect((await state(c!.id)).state).toBe('pending');
        expect(await claim(db, { workerId: 'w', now: at(30), leaseSeconds: LEASE, jobNames: ['health'] })).toBeNull();
        const again = await claim(db, { workerId: 'w', now: at(66), leaseSeconds: LEASE, jobNames: ['health'] });
        expect(again?.attempts).toBe(2);
    });

    it('marks the occurrence failed once attempts are exhausted, and says so', async () => {
        await seed('health', 'a', 0, { maxAttempts: 1 });
        const c = await claim(db, { workerId: 'w', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        const r = await fail(db, { occ: c!, workerId: 'w', now: at(5), error: 'x'.repeat(10000) });
        expect(r).toMatchObject({ exhausted: true, retryAt: null });
        const row = await state(c!.id);
        expect(row.state).toBe('failed');
        expect(row.last_error.length).toBe(4000); // bounded: an error message cannot bloat the table
    });

    it('skip records a reason and finishes the occurrence', async () => {
        await seed('health', 'a');
        const c = await claim(db, { workerId: 'w', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        expect(await skip(db, { id: c!.id, workerId: 'w', now: at(1), reason: 'nothing to do' })).toBe(true);
        expect(await state(c!.id)).toMatchObject({ state: 'skipped', last_error: 'nothing to do' });
    });
});

describe('retention and visibility', () => {
    it('prune removes only FINISHED occurrences older than the cutoff', async () => {
        await seed('health', 'old-done', 0);
        await seed('health', 'old-pending', 1);
        const c = await claim(db, { workerId: 'w', now: at(0), leaseSeconds: LEASE, jobNames: ['health'] });
        await complete(db, { id: c!.id, workerId: 'w', now: at(2), result: {} });
        const later = new Date(T0.getTime() + 40 * 86400000);
        expect(await prune(db, { now: later, days: 30 })).toBe(1);
        const left = (await pg.query<any>('SELECT occurrence_key FROM job_occurrences')).rows;
        expect(left).toEqual([{ occurrence_key: 'old-pending' }]); // pending work is never pruned
    });

    it('recentOccurrences returns newest first for the dashboard', async () => {
        await seed('health', 'a', 0);
        await seed('health', 'b', 100);
        expect((await recentOccurrences(db, 10)).map(r => r.occurrence_key)).toEqual(['b', 'a']);
    });
});

describe('lib/jobs never builds SQL by string interpolation', () => {
    const dir = join(__dirname, '..', 'jobs');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.ts') ? [join(d, n)] : []));

    it('no template literal containing SQL uses ${...}', () => {
        const offenders: string[] = [];
        for (const f of walk(dir)) {
            for (const m of readFileSync(f, 'utf8').matchAll(/`([^`]*)`/g)) {
                if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(m[1]) && m[1].includes('${')) offenders.push(`${f}: ${m[1].slice(0, 60)}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('does not use hashtext or advisory locks (32-bit, collidable): overlap is a unique index', () => {
        for (const f of walk(dir)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/hashtext|pg_advisory/i);
    });
});
