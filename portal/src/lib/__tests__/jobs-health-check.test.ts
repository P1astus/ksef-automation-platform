import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { healthCheckJob } from '../jobs/health-check';
import { buildJobs, parseJobList } from '../jobs/registry';
import { createAlerts } from '../jobs/alerts';
import { tickOnce } from '../jobs/runner';
import type { Db } from '../jobs/queue';
import type { JobContext } from '../jobs/types';

let pg: PGlite;
let db: Db;
const NOW = new Date('2026-09-21T10:07:00Z');

const resp = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const routes = (map: { ksef?: () => Promise<Response>; sidecar?: () => Promise<Response> }) =>
    vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes('/security/public-key-certificates')) return (map.ksef ?? (async () => resp(200, [])))();
        if (u.includes('/actuator/health')) return (map.sidecar ?? (async () => resp(200, { status: 'UP' })))();
        throw new Error(`unexpected url ${u}`);
    }) as unknown as typeof fetch;

const opts = (fetchImpl: typeof fetch, over = {}) => ({
    ksefBaseUrl: 'https://ksef.example.invalid/v2', sidecarUrl: 'http://xades-sidecar:8090', fetchImpl, ...over,
});
const ctx = (over: Partial<JobContext> = {}, sendMail = vi.fn().mockResolvedValue(undefined)): JobContext => ({
    db, now: () => NOW, shadow: false, signal: new AbortController().signal,
    alerts: createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', log: () => {} }), log: () => {}, ...over,
});
const health = async () => (await pg.query<any>('SELECT check_type, status, details FROM system_health ORDER BY check_type')).rows;
const alertRows = async () => (await pg.query<any>('SELECT severity, source, subject FROM system_alerts')).rows;

beforeEach(async () => {
    pg = new PGlite();
    await applyCurrentSchema(pg);
    db = { query: (t, p) => pg.query(t, p as any[]) as any };
});

describe('health-check job (port of workflow 03)', () => {
    it('all healthy: three healthy samples, no alert', async () => {
        const r = await healthCheckJob(opts(routes({}))).run(ctx());
        expect(r.detail).toMatchObject({ overall: 'healthy' });
        expect(await health()).toEqual([
            { check_type: 'app_database', status: 'healthy', details: { error: null } },
            { check_type: 'java_sidecar', status: 'healthy', details: { error: null } },
            { check_type: 'ksef_api', status: 'healthy', details: { error: null } },
        ]);
        expect(await alertRows()).toEqual([]);
    });

    it('KSeF API answering 503: unhealthy with the HTTP status, a warning alert, and e-mail to ops', async () => {
        const sendMail = vi.fn().mockResolvedValue(undefined);
        await healthCheckJob(opts(routes({ ksef: async () => resp(503) }))).run(ctx({}, sendMail));
        expect((await health()).find(h => h.check_type === 'ksef_api')).toMatchObject({ status: 'unhealthy', details: { error: 'HTTP 503' } });
        expect(await alertRows()).toEqual([{ severity: 'warning', source: 'health-check', subject: 'KSeF Platform Health Check FAILED' }]);
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(sendMail.mock.calls[0][0].text).toMatch(/UNHEALTHY[\s\S]*KSeF: unhealthy[\s\S]*Sidecar: healthy[\s\S]*DB: healthy/);
    });

    it("a sidecar that answers 200 but whose actuator status is not UP is DEGRADED, as in the workflow", async () => {
        const r = await healthCheckJob(opts(routes({ sidecar: async () => resp(200, { status: 'OUT_OF_SERVICE' }) }))).run(ctx());
        expect((await health()).find(h => h.check_type === 'java_sidecar')).toMatchObject({ status: 'degraded', details: { error: 'Actuator status: OUT_OF_SERVICE' } });
        expect(r.detail).toMatchObject({ overall: 'degraded' });
        expect((await alertRows()).length).toBe(1);
    });

    it('a sidecar answering 503 (Spring reports DOWN that way) is unhealthy', async () => {
        await healthCheckJob(opts(routes({ sidecar: async () => resp(503, { status: 'DOWN' }) }))).run(ctx());
        expect((await health()).find(h => h.check_type === 'java_sidecar')).toMatchObject({ status: 'unhealthy', details: { error: 'HTTP 503' } });
    });

    it('a network failure is a RESULT (unhealthy with the message), not an exception that aborts the job', async () => {
        const r = await healthCheckJob(opts(routes({ ksef: async () => { throw new TypeError('fetch failed: ECONNREFUSED'); } }))).run(ctx());
        expect((await health()).find(h => h.check_type === 'ksef_api')).toMatchObject({ status: 'unhealthy', details: { error: expect.stringMatching(/ECONNREFUSED/) } });
        expect(r.processed).toBe(3);
    });

    it('a probe that hangs is cut off by its own timeout, and the other probes still report', async () => {
        const hang = (signal?: AbortSignal | null) => new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
        const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            if (String(url).includes('public-key')) return hang(init?.signal);
            return resp(200, { status: 'UP' });
        }) as unknown as typeof fetch;
        await healthCheckJob(opts(f, { ksefTimeoutMs: 30 })).run(ctx());
        const rows = await health();
        expect(rows.find(h => h.check_type === 'ksef_api')?.status).toBe('unhealthy');
        expect(rows.find(h => h.check_type === 'java_sidecar')?.status).toBe('healthy');
    });

    it('a failing DATABASE probe is reported as unhealthy while the samples are still written', async () => {
        const flaky: Db = { query: (t, p) => (t.includes('FROM clients') ? Promise.reject(new Error('relation "clients" does not exist')) : db.query(t, p)) };
        const r = await healthCheckJob(opts(routes({}))).run(ctx({ db: flaky }));
        expect((await health()).find(h => h.check_type === 'app_database')).toMatchObject({ status: 'unhealthy', details: { error: expect.stringMatching(/clients/) } });
        expect(r.detail).toMatchObject({ overall: 'unhealthy' });
    });

    it('failing to WRITE the samples is a real failure and throws, so the runner retries and eventually alerts', async () => {
        const noWrites: Db = { query: (t, p) => (t.includes('INSERT INTO system_health') ? Promise.reject(new Error('disk full')) : db.query(t, p)) };
        await expect(healthCheckJob(opts(routes({}))).run(ctx({ db: noWrites }))).rejects.toThrow('disk full');
    });

    it('SHADOW: computes the result but writes no samples and raises no alert', async () => {
        const sendMail = vi.fn();
        const r = await healthCheckJob(opts(routes({ ksef: async () => resp(500) }))).run(
            ctx({ shadow: true, alerts: createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', shadow: true, log: () => {} }) })
        );
        expect(r.detail).toMatchObject({ overall: 'unhealthy' });
        expect(await health()).toEqual([]);
        expect(await alertRows()).toEqual([]);
        expect(sendMail).not.toHaveBeenCalled();
    });
});

describe('through the runner (the whole harness, end to end)', () => {
    it('a tick runs the job, records its samples, and marks the occurrence succeeded', async () => {
        const job = healthCheckJob(opts(routes({})));
        const s = await tickOnce({ db, jobs: [job], enabled: ['health-check'], workerId: 'w', now: () => NOW, log: () => {} });
        expect(s.ran).toMatchObject([{ job: 'health-check', outcome: 'succeeded', shadow: false }]);
        expect((await health()).length).toBe(3);
        const occ = (await pg.query<any>('SELECT state, result FROM job_occurrences')).rows[0];
        expect(occ.state).toBe('succeeded');
        expect(occ.result.detail.overall).toBe('healthy');
    });
});

describe('registry', () => {
    it('is the 15-minute job workflow 03 was', () => {
        const [j] = buildJobs({});
        expect(j.name).toBe('health-check');
        expect(j.schedule).toEqual({ kind: 'every', minutes: 15 });
    });
    // Capture the URLs the registry's job really calls (the options live in a closure, so the only honest check is to run it).
    const urlsCalledBy = async (env: Record<string, string | undefined>) => {
        const seen: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (u: string | URL | Request) => { seen.push(String(u)); return resp(200, { status: 'UP' }); }));
        try { await buildJobs(env)[0].run(ctx()); } finally { vi.unstubAllGlobals(); }
        return seen;
    };

    it('defaults to the KSeF TEST API and never to production without the explicit setting', async () => {
        const urls = await urlsCalledBy({});
        expect(urls.some(u => u.startsWith('https://api-test.ksef.mf.gov.pl/v2/'))).toBe(true);
        expect(urls.some(u => u.includes('://api.ksef.mf.gov.pl'))).toBe(false);
        expect((await urlsCalledBy({ KSEF_ENVIRONMENT: 'test' })).some(u => u.includes('://api.ksef.mf.gov.pl'))).toBe(false);
        expect((await urlsCalledBy({ KSEF_ENVIRONMENT: 'prod' })).some(u => u.startsWith('https://api.ksef.mf.gov.pl/v2/'))).toBe(true);
    });

    it('probes the sidecar by its HYPHENATED name (Tomcat rejects an underscored Host header with a 400)', async () => {
        const url = (await urlsCalledBy({})).find(u => u.includes('/actuator/health'))!;
        expect(url).toBe('http://xades-sidecar:8090/actuator/health');
        expect(url).not.toContain('xades_sidecar');
        expect((await urlsCalledBy({ XADES_SIDECAR_URL: 'http://sidecar.internal:9000' })).find(u => u.includes('/actuator/health'))).toBe('http://sidecar.internal:9000/actuator/health');
    });
    it('parses the JOBS_* lists and treats empty as nothing', () => {
        expect(parseJobList(' health-check , offline24 ,')).toEqual(['health-check', 'offline24']);
        expect(parseJobList(undefined)).toEqual([]);
        expect(parseJobList('')).toEqual([]);
    });
});
