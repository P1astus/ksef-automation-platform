import { randomUUID } from 'node:crypto';
import { enqueue, type Db } from './queue';
import { buildJobs } from './registry';

type Env = Record<string, string | undefined>;

export async function enqueueManual(db: Db, jobName: string, env: Env = process.env): Promise<{ enqueued: boolean; occurrenceKey: string }> {
    const job = buildJobs(env).find(candidate => candidate.name === jobName);
    if (!job) throw new Error(`Unknown job: ${jobName}`);
    const occurrenceKey = `manual:${randomUUID()}`;
    const enqueued = await enqueue(db, {
        jobName: job.name,
        occurrenceKey,
        scheduledFor: new Date(),
        maxAttempts: job.maxAttempts,
        shadow: false,
    });
    return { enqueued, occurrenceKey };
}
