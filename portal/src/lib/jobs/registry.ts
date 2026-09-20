import type { Job } from './types';
import { healthCheckJob } from './health-check';
import { offline24MonitorJob } from './offline24-monitor';
import { invoiceRetrievalJob } from './invoice-retrieval';
import { initInteractiveSession, queryInvoices, terminateSession } from '../ksef-client';
import { decryptSecret, clientCredentialContext } from '../credential-crypto';
import { clientNotificationsOffline24Job, clientNotificationsReceivablesJob } from './client-notifications';
import { jpkPreparationJob } from './jpk-preparation';

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
        invoiceRetrievalJob({
            // KSeF base URL comes from KSEF_ENVIRONMENT inside ksef-client (test unless explicitly 'prod'), same as health-check.
            ksef: {
                authenticate: initInteractiveSession,
                query: (token, o) => queryInvoices(token, { subjectType: o.subjectType, dateFrom: o.dateFrom, dateTo: o.dateTo, pageOffset: o.pageOffset, pageSize: o.pageSize }),
                terminate: terminateSession,
            },
            decryptToken: (stored, clientId) => decryptSecret(stored, clientCredentialContext(clientId)),
        }),
        clientNotificationsOffline24Job,
        clientNotificationsReceivablesJob,
        jpkPreparationJob,
    ];
}

export function parseJobList(value: string | undefined): string[] {
    return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
