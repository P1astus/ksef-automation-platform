import type { Job } from './types';
import { healthCheckJob } from './health-check';
import { offline24MonitorJob } from './offline24-monitor';

// Every job the worker knows how to run. Adding a port means adding it here; the ENV decides which ones actually run
// (JOBS_ENABLED / JOBS_SHADOW), and an empty environment runs nothing.

type Env = Record<string, string | undefined>;

export function buildJobs(env: Env): Job[] {
    return [
        healthCheckJob({
            // Same rule as lib/ksef-client.ts. Never point this at production without the explicit setting.
            ksefBaseUrl: env.KSEF_ENVIRONMENT === 'prod' ? 'https://api.ksef.mf.gov.pl/v2' : 'https://api-test.ksef.mf.gov.pl/v2',
            sidecarUrl: env.XADES_SIDECAR_URL || 'http://xades-sidecar:8090',
        }),
        offline24MonitorJob(),
    ];
}

export function parseJobList(value: string | undefined): string[] {
    return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
