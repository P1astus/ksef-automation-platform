import { resolveDeployment } from '../deployment';
import { enqueue, type Db } from './queue';
import { parseJobList } from './registry';

// "Sync this client now" (POST /api/clients/[id]/sync) has three ways to get done, in this order:
//   scheduler - the embedded worker runs invoice-retrieval: enqueue an occurrence scoped to the client
//   webhook   - the legacy n8n webhook (N8N_SYNC_WEBHOOK_URL)
//   none      - neither is configured: the route answers 503 rather than claim a sync was queued
//
// The scheduler path is chosen only when the worker will really run the job for real: SCHEDULER_ENABLED is on AND
// invoice-retrieval is listed in JOBS_ENABLED (which compose passes to the portal too). An occurrence for a job the worker
// does not run would sit pending forever while the UI said "queued".

type Env = Record<string, string | undefined>;
export type ClientSyncMode = 'scheduler' | 'webhook' | 'none';

export function clientSyncMode(env: Env = process.env): ClientSyncMode {
    if (resolveDeployment(env).scheduler && parseJobList(env.JOBS_ENABLED).includes('invoice-retrieval')) return 'scheduler';
    if (env.N8N_SYNC_WEBHOOK_URL) return 'webhook';
    return 'none';
}

/**
 * Enqueue a client-scoped invoice-retrieval occurrence. The key is per client and per minute, so a double-click coalesces into
 * one occurrence instead of queueing the same sync twice. `enqueued: false` means one for this minute is already queued.
 */
export async function enqueueClientSync(db: Db, o: { clientId: number; firmId: number; now?: Date }): Promise<{ enqueued: boolean; occurrenceKey: string }> {
    const now = o.now ?? new Date();
    const occurrenceKey = `manual:client:${o.clientId}:${now.toISOString().slice(0, 16)}`;
    const enqueued = await enqueue(db, {
        jobName: 'invoice-retrieval', occurrenceKey, scheduledFor: now, maxAttempts: 2, shadow: false,
        payload: { clientId: o.clientId, firmId: o.firmId },
    });
    return { enqueued, occurrenceKey };
}
