import type { Job, JobResult } from './types';

// Port of workflow 03 (n8n "KSeF - Health Check"): every 15 minutes, probe the three moving parts, record three
// system_health rows, and raise a warning when anything is not healthy. Same status vocabulary as the workflow:
//   healthy | degraded (sidecar reachable but its actuator status is not UP) | unhealthy
//
// IDEMPOTENCY BOUNDARY: safe to re-run. A repeat only adds another sample row and (if still failing) another alert.
// A failing probe is a RESULT, never an exception. Only failing to WRITE the samples throws (then the runner retries).

export type Health = 'healthy' | 'degraded' | 'unhealthy';

export interface ProbeOutcome {
    check_type: 'ksef_api' | 'java_sidecar' | 'app_database';
    status: Health;
    error: string | null;
}

export interface HealthCheckOptions {
    ksefBaseUrl: string;   // e.g. https://api-test.ksef.mf.gov.pl/v2 (from KSEF_ENVIRONMENT, same rule as ksef-client.ts)
    sidecarUrl: string;    // e.g. http://xades-sidecar:8090 - the hyphenated name, never the underscored container name
    fetchImpl?: typeof fetch;
    ksefTimeoutMs?: number;
    sidecarTimeoutMs?: number;
}

const message = (err: unknown) => (err as Error)?.message ?? String(err);

export function healthCheckJob(opts: HealthCheckOptions): Job {
    const doFetch = opts.fetchImpl ?? fetch;
    return {
        name: 'health-check',
        schedule: { kind: 'every', minutes: 15 },
        timeoutMs: 60_000,
        maxAttempts: 3,
        lookbackMinutes: 30,
        async run(ctx): Promise<JobResult> {
            const withTimeout = (ms: number) => AbortSignal.any([ctx.signal, AbortSignal.timeout(ms)]);

            const ksef = async (): Promise<ProbeOutcome> => {
                try {
                    const res = await doFetch(`${opts.ksefBaseUrl}/security/public-key-certificates`, { signal: withTimeout(opts.ksefTimeoutMs ?? 10_000) });
                    return res.status >= 400
                        ? { check_type: 'ksef_api', status: 'unhealthy', error: `HTTP ${res.status}` }
                        : { check_type: 'ksef_api', status: 'healthy', error: null };
                } catch (err) {
                    return { check_type: 'ksef_api', status: 'unhealthy', error: message(err) };
                }
            };

            const sidecar = async (): Promise<ProbeOutcome> => {
                try {
                    const res = await doFetch(`${opts.sidecarUrl}/actuator/health`, { signal: withTimeout(opts.sidecarTimeoutMs ?? 5_000) });
                    if (res.status >= 400) return { check_type: 'java_sidecar', status: 'unhealthy', error: `HTTP ${res.status}` };
                    const body = (await res.json().catch(() => ({}))) as { status?: string };
                    return body.status && body.status !== 'UP'
                        ? { check_type: 'java_sidecar', status: 'degraded', error: `Actuator status: ${body.status}` }
                        : { check_type: 'java_sidecar', status: 'healthy', error: null };
                } catch (err) {
                    return { check_type: 'java_sidecar', status: 'unhealthy', error: message(err) };
                }
            };

            const database = async (): Promise<ProbeOutcome> => {
                try {
                    const r = await ctx.db.query('SELECT COUNT(*)::int AS client_count FROM clients');
                    return r.rows[0]?.client_count === undefined
                        ? { check_type: 'app_database', status: 'unhealthy', error: 'Query returned no results' }
                        : { check_type: 'app_database', status: 'healthy', error: null };
                } catch (err) {
                    return { check_type: 'app_database', status: 'unhealthy', error: message(err) };
                }
            };

            const services = await Promise.all([ksef(), sidecar(), database()]);
            const statuses = services.map(s => s.status);
            const overall: Health = statuses.includes('unhealthy') ? 'unhealthy' : statuses.includes('degraded') ? 'degraded' : 'healthy';
            const summary = `Health: ${overall.toUpperCase()} | KSeF: ${services[0].status} | Sidecar: ${services[1].status} | DB: ${services[2].status}`;

            // A shadow run computes and reports what it would do, and writes nothing.
            if (!ctx.shadow) {
                for (const s of services) {
                    await ctx.db.query(
                        'INSERT INTO system_health (check_type, status, details, checked_at) VALUES ($1, $2, $3::jsonb, $4)',
                        [s.check_type, s.status, JSON.stringify({ error: s.error }), ctx.now().toISOString()]
                    );
                }
            }
            if (overall !== 'healthy') {
                await ctx.alerts.raise({
                    severity: 'warning', source: 'health-check',
                    subject: 'KSeF Platform Health Check FAILED',
                    message: summary, details: { overall_status: overall, services },
                });
            }
            return { processed: services.length, detail: { overall, summary, services } };
        },
    };
}
