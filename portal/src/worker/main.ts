// The job worker: the process that replaces n8n's scheduler. Same image as the portal, different command
// (`node worker.js`, bundled by esbuild - see the Dockerfile). Inert unless JOBS_ENABLED / JOBS_SHADOW name jobs.
import { capabilities } from '@/lib/deployment';
import { assertLicenceStartup, loadFirmLicence } from '@/lib/licence';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import pool from '@/lib/db';
import { sendMail } from '@/lib/mail-transport';
import { buildJobs, parseJobList } from '@/lib/jobs/registry';
import { assertRunnerConfig, tickOnce, JobConfigError } from '@/lib/jobs/runner';
import { prune, type Db } from '@/lib/jobs/queue';

const TICK_MS = Number(process.env.JOBS_TICK_SECONDS || 30) * 1000;
const PRUNE_DAYS = 14; // must stay >= the largest job lookback (2 days)
const log = (m: string) => console.log(`[worker] ${m}`);

// The pool directly, NOT lib/db's query(): that helper logs the full SQL text of every call, which would flood a
// process that polls every few seconds.
const db: Db = { query: (text, params) => pool.query(text, params as any[]) as any };

async function main() {
    if (capabilities().accessProvider === 'licence') await assertLicenceStartup();
    const jobs = buildJobs(process.env);
    const enabled = parseJobList(process.env.JOBS_ENABLED);
    const shadow = parseJobList(process.env.JOBS_SHADOW);
    assertRunnerConfig(jobs, enabled, shadow); // a typo in JOBS_ENABLED stops the worker at start, loudly
    // os.hostname(), not $HOSTNAME: the Next.js image sets HOSTNAME=0.0.0.0 (its bind address), which would name every worker "0.0.0.0".
    const workerId = `${hostname()}-${randomUUID().slice(0, 8)}`;

    log(`start ${workerId} tz=${process.env.TZ || 'unset'} enabled=[${enabled}] shadow=[${shadow}] tick=${TICK_MS / 1000}s`);
    if (enabled.length === 0 && shadow.length === 0) log('no jobs enabled: idle (set JOBS_ENABLED to run jobs)');

    let stopping = false;
    for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { log(`${sig}: finishing the current tick, then exiting`); stopping = true; });

    let lastPrune = 0;
    while (!stopping) {
        try {
            if (capabilities().accessProvider === 'licence') {
                const firms = await pool.query('SELECT id FROM firms WHERE is_active = true');
                let licensed = true;
                for (const firm of firms.rows) if ((await loadFirmLicence(firm.id)).state !== 'ok') licensed = false;
                if (!licensed) { log('licence missing or expired: job tick skipped'); await new Promise(r => setTimeout(r, TICK_MS)); continue; }
            }
            const s = await tickOnce({
                db, jobs, enabled, shadow, workerId, sendMail,
                alertEmail: process.env.ALERT_EMAIL?.trim() || undefined,
                leaseSeconds: Number(process.env.JOBS_LEASE_SECONDS || 300),
                log,
            });
            if (s.ran.length) log(`tick: ${s.ran.map(r => `${r.job}=${r.outcome}${r.shadow ? '(shadow)' : ''}`).join(', ')}`);
            if (Date.now() - lastPrune > 3_600_000) {
                lastPrune = Date.now();
                const n = await prune(db, { now: new Date(), days: PRUNE_DAYS });
                if (n) log(`pruned ${n} finished occurrence(s)`);
            }
        } catch (err: any) {
            // A tick failing (database briefly unreachable...) must not kill the worker; it is logged and retried next tick.
            console.error(`[worker] tick failed: ${err?.message ?? err}`);
        }
        await new Promise(r => setTimeout(r, TICK_MS));
    }
    log('stopped');
    await pool.end();
}

main().catch(err => {
    console.error(`[worker] fatal: ${err?.message ?? err}`);
    process.exit(err instanceof JobConfigError ? 78 : 1); // 78 = EX_CONFIG: a restart loop will not fix a bad config
});
