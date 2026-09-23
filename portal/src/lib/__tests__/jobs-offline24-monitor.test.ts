import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { offline24MonitorJob } from '../jobs/offline24-monitor';
import { buildJobs } from '../jobs/registry';
import { createAlerts } from '../jobs/alerts';
import { offlineUrgency, offlineMarker } from '../offline-markers';
import type { Db } from '../jobs/queue';
import type { JobContext } from '../jobs/types';

// Port of workflow 05. The marker rule lives in SQL on the DB clock, so the "now" that matters for OFF/BFK is real time:
// deadlines below are built relative to Date.now(). The alert ladder uses ctx.now(), pinned separately.

let pg: PGlite;
let db: Db;
const H = 3_600_000;
const NOW = new Date('2026-09-21T10:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();

const ctx = (over: Partial<JobContext> = {}, sendMail = vi.fn().mockResolvedValue(undefined)): JobContext => ({
    db, now: () => NOW, shadow: false, signal: new AbortController().signal,
    alerts: createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', log: () => {} }), log: () => {}, ...over,
});

async function firm(name: string, over: { active?: boolean; status?: string } = {}): Promise<number> {
    const r = await pg.query<any>(
        `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, is_active, subscription_status)
         VALUES ($1::text, $1::text, $1::text || '@x.invalid', 'x', $2, $3) RETURNING id`,
        [name, over.active ?? true, over.status ?? 'trial']);
    return r.rows[0].id;
}
async function client(firmId: number, nip: string) {
    await pg.query(`INSERT INTO clients (firm_id, nip, client_name, auth_method) VALUES ($1, $2, 'c', 'token')`, [firmId, nip]);
}
async function offline(firmId: number, nip: string, no: string, deadline: string) {
    const r = await pg.query<any>(
        `INSERT INTO offline_invoices (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline)
         VALUES ($1, $2, $3, 'offline24', $4, $5) RETURNING id`, [firmId, nip, no, at(Date.now() - 48 * H), deadline]);
    return r.rows[0].id as number;
}
async function invoice(firmId: number, nip: string, no: string, ksef: string | null, marker: string | null = 'NrKSeF') {
    const r = await pg.query<any>(
        `INSERT INTO invoices (firm_id, client_nip, invoice_number, direction, seller_nip, ksef_number, jpk_marker)
         VALUES ($1, $2, $3, 'sales', $2, $4, $5) RETURNING id`, [firmId, nip, no, ksef, marker]);
    return r.rows[0].id as number;
}
const off = async (id: number) => (await pg.query<any>('SELECT * FROM offline_invoices WHERE id = $1', [id])).rows[0];
const marker = async (id: number) => (await pg.query<any>('SELECT jpk_marker FROM invoices WHERE id = $1', [id])).rows[0].jpk_marker;
const alerts = async () => (await pg.query<any>('SELECT severity, firm_id, client_nip, message FROM system_alerts ORDER BY id')).rows;

beforeEach(async () => {
    pg = new PGlite();
    await applyCurrentSchema(pg);
    db = { query: (t, p) => pg.query(t, p as any[]) as any };
});

describe('offline-markers: shared rules', () => {
    const now = NOW.getTime();
    it('urgency ladder thresholds are the workflow\'s: <=0 overdue, <1h, <4h, else ok', () => {
        expect(offlineUrgency(at(now), now).urgency).toBe('overdue');
        expect(offlineUrgency(at(now - 1), now).urgency).toBe('overdue');
        expect(offlineUrgency(at(now + 1), now).urgency).toBe('urgent_1h');
        expect(offlineUrgency(at(now + H - 1), now).urgency).toBe('urgent_1h');
        expect(offlineUrgency(at(now + H), now).urgency).toBe('urgent_4h');
        expect(offlineUrgency(at(now + 4 * H - 1), now).urgency).toBe('urgent_4h');
        expect(offlineUrgency(at(now + 4 * H), now).urgency).toBe('ok');
    });

    it('label texts match the workflow', () => {
        expect(offlineUrgency(at(now - 90 * 60_000), now).label).toBe('OVERDUE by 90 minutes');
        expect(offlineUrgency(at(now + 30 * 60_000), now).label).toBe('30 minutes remaining');
        expect(offlineUrgency(at(now + 2.5 * H), now).label).toBe('2.5 hours remaining');
        expect(offlineUrgency(at(now + 10 * H), now).label).toBe('10 hours remaining - safe');
    });

    it('pure marker and its SQL form agree, including a deadline that passed earlier TODAY (round 11 regression)', async () => {
        for (const offsetMs of [-6 * H, -1 * H, -1000, 1000, H, 30 * H]) {
            const deadline = at(Date.now() + offsetMs);
            const sql = (await pg.query<any>(`SELECT CASE WHEN $1::timestamptz < NOW() THEN 'BFK' ELSE 'OFF' END AS m`, [deadline])).rows[0].m;
            expect(sql, `offset ${offsetMs}`).toBe(offlineMarker(deadline, Date.now()));
        }
    });

    it('the marker agrees with determineJpkStatus: BFK needs a correction, OFF does not', async () => {
        const { determineJpkStatus } = await import('@/app/api/jpk/generate/route');
        const late = offlineMarker(at(Date.now() - H), Date.now());
        const ontime = offlineMarker(at(Date.now() + H), Date.now());
        expect([late, ontime]).toEqual(['BFK', 'OFF']);
        expect(determineJpkStatus([{ jpk_marker: late }])).toBe('correction_needed');
        expect(determineJpkStatus([{ jpk_marker: ontime }])).toBe('ready');
    });
});

describe('offline24-monitor job (port of workflow 05)', () => {
    it('is registered, on the workflow\'s 2-hourly Warsaw schedule', () => {
        const job = buildJobs({}).find(j => j.name === 'offline24-monitor')!;
        expect(job.schedule).toEqual({ kind: 'cron', expr: '0 */2 * * *', timezone: 'Europe/Warsaw' });
    });

    it('excludes deactivated and canceled firms without markers, failures or alerts', async () => {
        const active = await firm('eligible', { status: 'active' });
        const deactivated = await firm('deactivated', { active: false, status: 'active' });
        const canceled = await firm('canceled', { status: 'canceled' });
        for (const [firmId, nip] of [[active, '1111111111'], [deactivated, '2222222222'], [canceled, '3333333333']] as const) {
            await client(firmId, nip);
            await offline(firmId, nip, `FV/${nip}`, at(Date.now() + 6 * H));
            await invoice(firmId, nip, `FV/${nip}`, `${nip}-20260921-AAAAAA-01`);
        }
        const log = vi.fn();
        const result = await offline24MonitorJob().run(ctx({ log }));
        const rows = await pg.query<any>('SELECT firm_id, uploaded_to_ksef FROM offline_invoices ORDER BY firm_id');
        expect(rows.rows).toEqual([
            { firm_id: active, uploaded_to_ksef: true },
            { firm_id: deactivated, uploaded_to_ksef: false },
            { firm_id: canceled, uploaded_to_ksef: false },
        ]);
        expect(result).toMatchObject({ processed: 1, failures: [], detail: { pending: 1, excluded: 2 } });
        expect(log).toHaveBeenCalledWith('offline24-monitor: excluded 2 invoice(s) belonging to inactive firms');
        expect(await alerts()).toEqual([]);
    });

    it('found in KSeF and uploaded after the deadline: uploaded, marker BFK', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/1', at(Date.now() - 6 * H));
        const inv = await invoice(f, '1111111111', 'FV/1', '1111111111-20260921-AAAAAA-01');
        const r = await offline24MonitorJob().run(ctx());
        expect(r.failures).toEqual([]);
        expect(await off(o)).toMatchObject({ uploaded_to_ksef: true, ksef_number: '1111111111-20260921-AAAAAA-01' });
        expect(await marker(inv)).toBe('BFK');
    });

    it('found in KSeF before the deadline: marker OFF', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        await offline(f, '1111111111', 'FV/1', at(Date.now() + 6 * H));
        const inv = await invoice(f, '1111111111', 'FV/1', '1111111111-20260921-AAAAAA-01');
        await offline24MonitorJob().run(ctx());
        expect(await marker(inv)).toBe('OFF');
    });

    it('CROSS-TENANT: a KSeF number held by two firms only ever marks the matched firm\'s invoice', async () => {
        // Post-contract reality: buyer and seller can both be firms on the platform, so only UNIQUE(firm_id, client_nip, ksef_number) remains.
        await pg.query('ALTER TABLE invoices DROP CONSTRAINT invoices_ksef_number_key');
        const a = await firm('a'); const b = await firm('b');
        await client(a, '1111111111'); await client(b, '2222222222');
        const shared = '1111111111-20260921-AAAAAA-01';
        await offline(a, '1111111111', 'FV/1', at(Date.now() - 6 * H));
        const invA = await invoice(a, '1111111111', 'FV/1', shared);
        const invB = await invoice(b, '2222222222', 'FV/1', shared, 'NrKSeF'); // another firm's copy of the same KSeF number
        await offline24MonitorJob().run(ctx());
        expect(await marker(invA)).toBe('BFK');
        expect(await marker(invB)).toBe('NrKSeF'); // the pre-port SQL (WHERE ksef_number = $2) turned this into BFK
    });

    it('an invoice belonging to another firm is never matched to this firm\'s offline row', async () => {
        const a = await firm('a'); const b = await firm('b');
        await client(a, '1111111111'); await client(b, '1111111111');
        const o = await offline(a, '1111111111', 'FV/1', at(Date.now() + 6 * H));
        const other = await invoice(b, '1111111111', 'FV/1', '1111111111-20260921-BBBBBB-01', 'NrKSeF');
        await offline24MonitorJob().run(ctx());
        expect((await off(o)).uploaded_to_ksef).toBe(false);
        expect(await marker(other)).toBe('NrKSeF');
    });

    it('does not match a different client copy or a purchase with the same invoice number', async () => {
        const f = await firm('a');
        await client(f, '1111111111'); await client(f, '2222222222');
        const o = await offline(f, '1111111111', 'FV/1', at(Date.now() + 6 * H));
        const other = await invoice(f, '2222222222', 'FV/1', '2222222222-20260921-AAAAAA-01');
        await pg.query('UPDATE invoices SET buyer_nip = $1 WHERE id = $2', ['1111111111', other]);
        await offline24MonitorJob().run(ctx());
        expect((await off(o)).uploaded_to_ksef).toBe(false);
        expect(await marker(other)).toBe('NrKSeF');
        await pg.query("UPDATE invoices SET client_nip = $1, direction = 'purchase' WHERE id = $2", ['1111111111', other]);
        await offline24MonitorJob().run(ctx());
        expect((await off(o)).uploaded_to_ksef).toBe(false);
    });

    it('completed by someone else between SELECT and write: the marker is not touched (single-statement guard)', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/1', at(Date.now() - 6 * H));
        const inv = await invoice(f, '1111111111', 'FV/1', '1111111111-20260921-AAAAAA-01', 'OFF');
        const racing: Db = { query: async (t, p) => {
            const res = await db.query(t, p);
            if (t.includes('ORDER BY oi.upload_deadline')) await pg.query('UPDATE offline_invoices SET uploaded_to_ksef = true WHERE id = $1', [o]);
            return res;
        } };
        await offline24MonitorJob().run(ctx({ db: racing }));
        expect(await marker(inv)).toBe('OFF'); // would have been BFK had the marker been written unguarded
    });

    it.each([
        ['overdue', -2 * H, 'critical', 'alert_sent_overdue'],
        ['<1h', 30 * 60_000, 'warning', 'alert_sent_1h'],
        ['<4h', 2 * H, 'info', 'alert_sent_4h'],
    ])('%s: raises a %s alert, then sets %s', async (_n, offsetMs, severity, flag) => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/9', at(NOW.getTime() + (offsetMs as number)));
        const r = await offline24MonitorJob().run(ctx());
        expect(r.failures).toEqual([]);
        const rows = await alerts();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ severity, firm_id: f, client_nip: '1111111111' });
        expect(rows[0].message).toContain('FV/9');
        const row = await off(o);
        expect(row[flag as string]).toBe(true);
        for (const other of ['alert_sent_overdue', 'alert_sent_1h', 'alert_sent_4h'].filter(x => x !== flag)) expect(row[other]).toBe(false);
    });

    it('sends at most one alert per urgency tier for an unresolved invoice', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/9', at(NOW.getTime() - 2 * H));
        await offline24MonitorJob().run(ctx());
        await offline24MonitorJob().run(ctx());
        expect(await alerts()).toHaveLength(1);
        expect((await off(o)).alert_sent_overdue).toBe(true);
    });

    it('allows one alert as an unresolved invoice advances through each urgency tier', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const deadline = NOW.getTime() + 2 * H;
        const o = await offline(f, '1111111111', 'FV/10', at(deadline));
        await offline24MonitorJob().run(ctx());
        await offline24MonitorJob().run(ctx({ now: () => new Date(deadline - 30 * 60_000) }));
        await offline24MonitorJob().run(ctx({ now: () => new Date(deadline + H) }));
        await offline24MonitorJob().run(ctx({ now: () => new Date(deadline + H) }));
        expect(await alerts()).toHaveLength(3);
        expect((await off(o)).alert_sent_4h).toBe(true);
        expect((await off(o)).alert_sent_1h).toBe(true);
        expect((await off(o)).alert_sent_overdue).toBe(true);
    });

    it('more than 4h left: no alert, no flag', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/9', at(NOW.getTime() + 10 * H));
        await offline24MonitorJob().run(ctx());
        expect(await alerts()).toEqual([]);
        expect(await off(o)).toMatchObject({ alert_sent_4h: false, alert_sent_1h: false, alert_sent_overdue: false });
    });

    it('the flag is set only AFTER the alert was recorded: an unrecordable alert leaves it false and is a failure', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/9', at(NOW.getTime() - 2 * H));
        const broken = { raise: async () => ({ recorded: false, delivered: false }) };
        const r = await offline24MonitorJob().run(ctx({ alerts: broken }));
        expect((await off(o)).alert_sent_overdue).toBe(false);
        expect(r.failures).toHaveLength(1);
        expect(r.failures![0]).toMatchObject({ firmId: f, clientNip: '1111111111' });
    });

    it('one failing row does not stop the others', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o1 = await offline(f, '1111111111', 'FV/1', at(NOW.getTime() - 3 * H));
        const o2 = await offline(f, '1111111111', 'FV/2', at(NOW.getTime() - 2 * H));
        let calls = 0;
        const flaky = { raise: async () => { if (calls++ === 0) throw new Error('boom'); return { recorded: true, delivered: true }; } };
        const r = await offline24MonitorJob().run(ctx({ alerts: flaky }));
        expect(r.failures).toHaveLength(1);
        expect(r.failures![0].error).toBe('boom');
        expect((await off(o1)).alert_sent_overdue).toBe(false);
        expect((await off(o2)).alert_sent_overdue).toBe(true);
    });

    it('SHADOW: classifies but writes nothing - no marker, no upload, no flag, no alert, no mail', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const matched = await offline(f, '1111111111', 'FV/1', at(Date.now() - 6 * H));
        const inv = await invoice(f, '1111111111', 'FV/1', '1111111111-20260921-AAAAAA-01', 'NrKSeF');
        const overdue = await offline(f, '1111111111', 'FV/2', at(NOW.getTime() - 2 * H));
        const sendMail = vi.fn();
        const r = await offline24MonitorJob().run(ctx({
            shadow: true,
            alerts: createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', shadow: true, log: () => {} }),
        }, sendMail));
        expect(r.failures).toEqual([]);
        expect(r.detail).toMatchObject({ pending: 2, found: 1, overdue: 1 });
        expect(await marker(inv)).toBe('NrKSeF');
        expect((await off(matched)).uploaded_to_ksef).toBe(false);
        expect(await off(overdue)).toMatchObject({ alert_sent_overdue: false });
        expect(await alerts()).toEqual([]);
        expect(sendMail).not.toHaveBeenCalled();
    });

    it('a matched invoice is uploaded even when its deadline is in the alert window (found wins over the ladder)', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const o = await offline(f, '1111111111', 'FV/1', at(Date.now() - 30 * 60_000));
        await invoice(f, '1111111111', 'FV/1', '1111111111-20260921-AAAAAA-01');
        await offline24MonitorJob().run(ctx());
        expect((await off(o)).uploaded_to_ksef).toBe(true);
        expect(await alerts()).toEqual([]);
    });
});
