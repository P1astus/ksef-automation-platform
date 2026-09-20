import { randomUUID } from 'node:crypto';
import { enqueue, type Db } from './queue';
import { buildJobs } from './registry';

type Env = Record<string, string | undefined>;

export async function enqueueManual(db: Db, jobName: string, env: Env = process.env): Promise<{ enqueued: boolean; occurrenceKey: string }> {
    const job = buildJobs(env).find(candidate => candidate.name === jobName);
    if (!job) throw new Error(`Unknown job: ${jobName}`);
    const listed = (value: string | undefined) => (value ?? '').split(',').map(s => s.trim()).includes(jobName);
    const enabled = listed(env.JOBS_ENABLED);
    const shadow = listed(env.JOBS_SHADOW);
    if (enabled === shadow) throw new Error(`Job unavailable: ${jobName} must be configured in exactly one of JOBS_ENABLED or JOBS_SHADOW`);
    const occurrenceKey = `manual:${randomUUID()}`;
    const enqueued = await enqueue(db, {
        jobName: job.name,
        occurrenceKey,
        scheduledFor: new Date(),
        maxAttempts: job.maxAttempts,
        shadow,
    });
    return { enqueued, occurrenceKey };
}
