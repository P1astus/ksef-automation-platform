/** Opt-in retirement report. Run with COMPARE_06_09_PORT against a disposable fixture DB. */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import pg from 'pg';
import { jpkPreparationJob } from '@/lib/jobs/jpk-preparation';
import { clientNotificationsOffline24Job, clientNotificationsReceivablesJob } from '@/lib/jobs/client-notifications';
import { offlineUrgency } from '@/lib/offline-markers';
import type { JobContext } from '@/lib/jobs/types';
import { isValidTaxOfficeCode } from '@/lib/tax-office-codes';

const { sentMail } = vi.hoisted(() => ({ sentMail: [] as any[] }));
vi.mock('@/lib/mail-transport', () => ({ sendMail: async (message: any) => { sentMail.push(message); } }));

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
                { what: 'JPK email recipient', old: 'hardcoded workflow mailbox', job: 'firm admin_email', right: 'job: firm isolation' },
                { what: '09 offline warnings', old: legacyOffline, job: offline.processed, right: 'same route logic; equal' },
                { what: '09 receivables digests', old: Number(legacyReceivables.rows[0].n), job: receivables.processed, right: 'same route logic; equal' },
            ];
            const closedDifferences = [{ what: 'JPK per-client audit', old: 'one row per processed client', job: 'one tenant-scoped success/failure row per processed client in real mode; zero rows in shadow', result: 'closed' }];
            console.log('WORKFLOW_06_09_RETIREMENT_REPORT ' + JSON.stringify({ fixture: 'stress fixtures with one rollback-only overdue receivable', period, legacyClients: legacyClients.rows.length, jpk: { processed: jpk.processed, failures: jpk.failures?.length, firstFailure: jpk.failures?.[0]?.error.slice(0, 130) }, offline, receivables, closedDifferences, remainingDifferences: differences }));
            expect(jpk.processed! + (jpk.failures?.length || 0)).toBe(legacyClients.rows.length);
        } finally { await db.query('ROLLBACK'); await db.end(); }
    }, 120000);
});

describe('workflow 06 versus JPK preparation with valid tax data', () => {
    testIfEnabled('compares file content and every client outcome without delivery', async () => {
        const db = new pg.Client({ host: '127.0.0.1', port: Number(process.env.COMPARE_06_09_PORT), user: 'ksef_app', database: 'ksef_platform', password: fixturePassword() });
        await db.connect();
        sentMail.length = 0;
        await db.query('BEGIN');
        try {
            await db.query(readFileSync(join(ROOT, 'compare-06-realistic.sql'), 'utf8'));
            const clients = await db.query(`SELECT c.nip, c.tax_office_code, c.taxpayer_type, c.firm_id FROM clients c JOIN firms f ON f.id=c.firm_id WHERE f.slug='codex-compare-06' ORDER BY c.nip`);
            expect(clients.rows).toHaveLength(3);
            expect(clients.rows.every(c => isValidTaxOfficeCode(c.tax_office_code))).toBe(true);
            expect(clients.rows.some(c => c.taxpayer_type === 'individual')).toBe(true);
            const w06 = workflow('06-jpk-vat-preparation.json');
            const period = '2026-02';
            const oldClients = await db.query<{ client_nip: string; firm_id: number }>(node(w06, 'Get Clients for Period').parameters.query.slice(1), [period, '2026-02-01', '2026-02-28']);
            const legacy = new Map<string, any[]>();
            for (const c of oldClients.rows) {
                const rows = await db.query(node(w06, 'Get Client Invoices').parameters.query.slice(1), [c.client_nip, c.firm_id, period, '2026-02-01', '2026-02-28']);
                legacy.set(`${c.firm_id}:${c.client_nip}`, rows.rows);
            }
            const now = new Date('2026-03-05T07:00:00Z');
            const ctx: JobContext = { db, now: () => now, scheduledFor: now, shadow: false, signal: new AbortController().signal, alerts: { raise: async () => ({ recorded: false, delivered: false }) }, log: () => {} };
            const result = await jpkPreparationJob.run(ctx);
            const realisticFirmId = clients.rows[0].firm_id;
            expect(result.failures?.filter(failure => failure.firmId === realisticFirmId)).toEqual([]);
            expect(result.processed).toBe(3);
            expect(sentMail).toHaveLength(3);
            const prepared = await db.query(`SELECT p.firm_id, p.client_nip, p.period, p.export_data, p.status, p.total_invoices, p.nr_ksef_count, p.off_count, p.bfk_count, p.di_count
                FROM jpk_preparations p JOIN firms f ON f.id=p.firm_id WHERE f.slug='codex-compare-06' ORDER BY p.client_nip`);
            expect(prepared.rows).toHaveLength(3);
            const audits = await db.query(`SELECT a.client_nip, a.firm_id, a.success, a.error_message, a.details
                FROM audit_log a JOIN firms f ON f.id=a.firm_id
                WHERE f.slug='codex-compare-06' AND a.action='jpk_vat_preparation' ORDER BY a.client_nip`);
            expect(audits.rows).toHaveLength(3);
            expect(audits.rows.every(a => a.success === true && a.error_message === null && a.details.period === period && Number.isInteger(a.details.client_id))).toBe(true);
            const expected: Record<string, [number, number, number, number, number, string]> = {
                '2043321812': [2, 1, 1, 0, 0, 'ready'],
                '3654235114': [2, 1, 0, 1, 0, 'correction_needed'],
                '9386379401': [2, 1, 0, 0, 1, 'in_progress'],
            };
            const report: any[] = [];
            for (const p of prepared.rows) {
                const [total, nr, off, bfk, di, status] = expected[p.client_nip];
                expect([p.total_invoices, p.nr_ksef_count, p.off_count, p.bfk_count, p.di_count, p.status]).toEqual([total, nr, off, bfk, di, status]);
                expect(p.period).toBe(period);
                expect(p.export_data).toContain('<tns:Rok>2026</tns:Rok>');
                expect(p.export_data).toContain('<tns:Miesiac>2</tns:Miesiac>');
                const attachment = sentMail.find(m => m.subject.includes(p.client_nip) || m.attachments?.[0]?.filename.includes(p.client_nip))?.attachments?.[0];
                expect(attachment?.filename).toBe(`JPK_VAT_${p.client_nip}_${period}.csv`);
                const csv = attachment.content.toString('utf8');
                expect(csv).toContain('Numer_faktury;Data;NIP_kontrahenta;Kwota_netto;Kwota_VAT;Kwota_brutto;NrKSeF;OFF;BFK;DI;Numer_KSeF');
                expect(csv.split('\r\n').filter((line: string) => line && !line.includes('Numer_faktury'))).toHaveLength(total);
                const old = legacy.get(`${p.firm_id}:${p.client_nip}`)!;
                const audit = audits.rows.find(a => a.client_nip === p.client_nip);
                expect(audit?.details).toMatchObject({ period, status, stats: { total, nrksef: nr, off, bfk, di } });
                report.push({ nip: p.client_nip, oldRows: old.length, jobRows: total, status, markers: { nr, off, bfk, di }, perClientAudit: 'parity closed', csvAttachedByOld: Boolean(node(w06, 'Send JPK Email').parameters.options?.attachments), csvAttachedByJob: true });
            }
            expect(legacy.get(`${realisticFirmId}:9386379401`)?.map(i => i.invoice_number)).toContain('G-OVERRIDE-OUT');
            expect(prepared.rows.find(p => p.client_nip === '9386379401')?.export_data).not.toContain('G-OVERRIDE-OUT');
            expect(prepared.rows.find(p => p.client_nip === '9386379401')?.export_data).toContain('G-OVERRIDE-IN');
            expect(prepared.rows.find(p => p.client_nip === '2043321812')?.export_data).toContain('<tns:OFF>1</tns:OFF>');
            expect(prepared.rows.find(p => p.client_nip === '3654235114')?.export_data).toContain('<tns:BFK>1</tns:BFK>');
            expect(prepared.rows.find(p => p.client_nip === '9386379401')?.export_data).toContain('<tns:DI>1</tns:DI>');
            console.log('WORKFLOW_06_CONTENT_REPORT ' + JSON.stringify({ fixture: 'realistic JPK plus any preloaded stress data', clients: report, unrelatedFixtureFailures: result.failures?.length || 0, closedDifference: 'per-client audit parity' }));
        } finally {
            await db.query('ROLLBACK');
            await db.end();
        }
    }, 120000);
});
