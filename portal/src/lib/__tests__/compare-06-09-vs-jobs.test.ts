/** Opt-in retirement report. Run with COMPARE_06_09_PORT against a disposable fixture DB. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import { jpkPreparationJob } from '@/lib/jobs/jpk-preparation';
import { clientNotificationsOffline24Job, clientNotificationsReceivablesJob } from '@/lib/jobs/client-notifications';
import { offlineUrgency } from '@/lib/offline-markers';
import type { JobContext } from '@/lib/jobs/types';

const ROOT = join(__dirname, '..', '..', '..', '..');
const enabled = Boolean(process.env.COMPARE_06_09_PORT);
const testIfEnabled = enabled ? it : it.skip;

function fixturePassword(): string {
    const line = readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/).find(s => s.startsWith('KSEF_DB_PASSWORD='));
    if (!line) throw new Error('KSEF_DB_PASSWORD is required for isolated comparison');
    return line.slice('KSEF_DB_PASSWORD='.length).replace(/^['"]|['"]$/g, '');
}

function workflow(name: string) {
    return JSON.parse(readFileSync(join(ROOT, 'workflows', name), 'utf8'));
}
function node(w: any, name: string) {
    const found = w.nodes.find((n: any) => n.name === name);
    if (!found) throw new Error(`Missing workflow node: ${name}`);
    return found;
}

describe('workflow 06/09 retirement comparison on stress fixtures', () => {
    testIfEnabled('runs real jobs in shadow and reports legacy outcomes and differences', async () => {
        const db = new pg.Client({ host: '127.0.0.1', port: Number(process.env.COMPARE_06_09_PORT), user: 'ksef_app', database: 'ksef_platform', password: fixturePassword() });
        await db.connect();
        try {
            const w06 = workflow('06-jpk-vat-preparation.json');
            const w09 = workflow('09-client-notifications.json');
            expect(node(w06, 'Schedule JPK Monthly').parameters.rule.interval[0].expression).toEqual(jpkPreparationJob.schedule.kind === 'cron' ? jpkPreparationJob.schedule.expr : '');
            expect(node(w09, 'Every 2 Hours - Offline24 Warnings').parameters.rule.interval[0].expression).toEqual(clientNotificationsOffline24Job.schedule.kind === 'cron' ? clientNotificationsOffline24Job.schedule.expr : '');
            expect(node(w09, 'Weekly Monday 08:00 - Receivables Digest').parameters.rule.interval[0].expression).toEqual(clientNotificationsReceivablesJob.schedule.kind === 'cron' ? clientNotificationsReceivablesJob.schedule.expr : '');
            expect(node(w09, 'Call Notify Offline24').parameters.url.endsWith('/api/notify/offline24')).toBe(true);
            expect(node(w09, 'Call Notify Receivables').parameters.url.endsWith('/api/notify/receivables')).toBe(true);
            const before = await db.query(`SELECT
                (SELECT count(*) FROM jpk_preparations) AS preparations,
                (SELECT count(*) FROM zus_declarations) AS zus,
                (SELECT count(*) FROM offline_invoices WHERE client_notified_4h OR client_notified_1h OR client_notified_overdue) AS notifications,
                (SELECT count(*) FROM system_alerts) AS alerts`);
            await db.query('BEGIN');
            await db.query("UPDATE invoices SET payment_status='unpaid', due_date='2026-09-01' WHERE id=(SELECT id FROM invoices WHERE direction='sales' LIMIT 1)");
            const now = new Date('2026-03-05T07:00:00.000Z'); // fifth, 08:00 Warsaw
            const context: JobContext = { db, now: () => now, scheduledFor: now, shadow: true, signal: new AbortController().signal, alerts: { raise: async () => ({ recorded: false, delivered: false }) }, log: () => {} };
            const period = '2026-02';
            const notifyContext = { ...context, now: () => new Date('2026-09-22T00:00:00.000Z') };
            const legacyClientsSql = node(w06, 'Get Clients for Period').parameters.query.replace(/^=/, '');
            const legacyClients = await db.query<{ client_nip: string; firm_id: number }>(legacyClientsSql, [period, '2026-02-01', '2026-02-28']);
            const legacyInvoicesSql = node(w06, 'Get Client Invoices').parameters.query.replace(/^=/, '');
            let legacyInvoiceCount = 0;
            for (const client of legacyClients.rows) {
                const invoices = await db.query(legacyInvoicesSql, [client.client_nip, client.firm_id, period, '2026-02-01', '2026-02-28']);
                legacyInvoiceCount += invoices.rowCount || 0;
            }
            const jpk = await jpkPreparationJob.run(context);
            const offline = await clientNotificationsOffline24Job.run(notifyContext);
            const receivables = await clientNotificationsReceivablesJob.run(notifyContext);
            // Workflow 09 delegates to the same HTTP routes that call these two notification functions.
            // Its old observable result is therefore the route's candidate count at this pinned time.
            const offlineCandidates = await db.query(`SELECT oi.upload_deadline, oi.client_notified_4h, oi.client_notified_1h, oi.client_notified_overdue
                FROM offline_invoices oi JOIN clients c ON c.nip=oi.client_nip AND c.firm_id=oi.firm_id
                WHERE oi.uploaded_to_ksef=false AND c.contact_email IS NOT NULL
                AND NOT (oi.client_notified_4h AND oi.client_notified_1h AND oi.client_notified_overdue)`);
            const legacyOffline = offlineCandidates.rows.filter(row => {
                const urgency = offlineUrgency(row.upload_deadline, notifyContext.now().getTime()).urgency;
                return urgency === 'overdue' && !row.client_notified_overdue || urgency === 'urgent_1h' && !row.client_notified_1h || urgency === 'urgent_4h' && !row.client_notified_4h;
            }).length;
            const legacyReceivables = await db.query(`SELECT count(DISTINCT c.id) AS n FROM invoices i JOIN clients c ON i.client_nip=c.nip AND i.firm_id=c.firm_id
                WHERE i.direction='sales' AND i.payment_status='unpaid' AND i.due_date IS NOT NULL AND i.due_date < NOW() AND c.contact_email IS NOT NULL`);
            const after = await db.query(`SELECT
                (SELECT count(*) FROM jpk_preparations) AS preparations,
                (SELECT count(*) FROM zus_declarations) AS zus,
                (SELECT count(*) FROM offline_invoices WHERE client_notified_4h OR client_notified_1h OR client_notified_overdue) AS notifications,
                (SELECT count(*) FROM system_alerts) AS alerts`);
            expect(after.rows[0]).toEqual(before.rows[0]);
            expect(offline.processed).toBe(legacyOffline);
            expect(receivables.processed).toBe(Number(legacyReceivables.rows[0].n));
            const differences = [
                { what: 'JPK output', old: `${legacyClients.rows.length} CSV/preparation email attempts (${legacyInvoiceCount} selected invoice rows)`, job: `${jpk.processed || 0} validated JPK outputs; ${jpk.failures?.length || 0} client failures`, right: 'job: a tax file must fail closed when required taxpayer details or valid JPK data are missing' },
                { what: 'JPK selection', old: 'jpk_period match OR issue_date in period', job: 'jpk_period match OR (null period AND issue_date in period)', right: 'job: an explicit JPK period must override issue date' },
                { what: 'JPK artifact', old: 'CSV email plus summary upsert', job: 'validated JPK XML preparation plus CSV attachment', right: 'job: the tax XML is validated and CSV is only a supporting attachment' },
                { what: 'JPK per-client audit', old: 'audit_log row for each processed client', job: 'durable job occurrence but no per-client audit_log row', right: 'old per-client audit requirement; add tenant-scoped equivalent before retirement' },
                { what: 'JPK email recipient', old: 'hardcoded workflow mailbox', job: 'firm admin_email', right: 'job: firm isolation' },
                { what: '09 offline warnings', old: legacyOffline, job: offline.processed, right: 'same route logic; equal' },
                { what: '09 receivables digests', old: Number(legacyReceivables.rows[0].n), job: receivables.processed, right: 'same route logic; equal' },
            ];
            console.log('WORKFLOW_06_09_RETIREMENT_REPORT ' + JSON.stringify({ fixture: 'stress fixtures with one rollback-only overdue receivable', period, legacyClients: legacyClients.rows.length, jpk: { processed: jpk.processed, failures: jpk.failures?.length, firstFailure: jpk.failures?.[0]?.error.slice(0, 130) }, offline, receivables, differences }));
            expect(jpk.processed! + (jpk.failures?.length || 0)).toBe(legacyClients.rows.length);
        } finally { await db.query('ROLLBACK'); await db.end(); }
    }, 120000);
});
