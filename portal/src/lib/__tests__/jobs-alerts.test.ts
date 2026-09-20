import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { createAlerts } from '../jobs/alerts';
import type { Db } from '../jobs/queue';

let pg: PGlite;
let db: Db;
const logs: string[] = [];
const log = (m: string) => { logs.push(m); };
const alerts = async () => (await pg.query<any>('SELECT * FROM system_alerts ORDER BY id')).rows;
const audits = async () => (await pg.query<any>('SELECT * FROM audit_log ORDER BY id')).rows;

beforeEach(async () => {
    pg = new PGlite();
    await applyCurrentSchema(pg);
    db = { query: (t, p) => pg.query(t, p as any[]) as any };
    logs.length = 0;
});

const critical = { severity: 'critical' as const, source: 'health-check', subject: 'KSeF API down', message: 'HTTP 503', clientNip: '1234567890' };

describe('createAlerts.raise', () => {
    it('records a durable alert AND the audit_log row workflow 01 used to write', async () => {
        const sendMail = vi.fn().mockResolvedValue(undefined);
        const r = await createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', log }).raise(critical);
        expect(r).toEqual({ recorded: true, delivered: true });
        const [a] = await alerts();
        expect(a).toMatchObject({ severity: 'critical', source: 'health-check', subject: 'KSeF API down', client_nip: '1234567890' });
        expect(a.delivered_at).not.toBeNull();
        expect(a.delivery_error).toBeNull();
        expect((await audits())[0]).toMatchObject({ action: 'alert_critical', workflow_name: 'health-check', client_nip: '1234567890', success: true });
    });

    it('e-mails critical and warning alerts to ALERT_EMAIL, and never info', async () => {
        const sendMail = vi.fn().mockResolvedValue(undefined);
        const a = createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', log });
        await a.raise({ ...critical, severity: 'info' });
        expect(sendMail).not.toHaveBeenCalled();
        await a.raise({ ...critical, severity: 'warning' });
        await a.raise(critical);
        expect(sendMail).toHaveBeenCalledTimes(2);
        expect(sendMail.mock.calls[0][0].to).toBe('ops@example.invalid');
        expect(sendMail.mock.calls[1][0].subject).toContain('KRYTYCZNY');
    });

    it('a delivery failure is RECORDED on the alert and logged, and does not throw into the job', async () => {
        const sendMail = vi.fn().mockRejectedValue(new Error('SMTP 550 mailbox unavailable'));
        const r = await createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', log }).raise(critical);
        expect(r).toEqual({ recorded: true, delivered: false });
        const [a] = await alerts();
        expect(a.delivered_at).toBeNull();
        expect(a.delivery_error).toMatch(/550/);
        expect(logs.join('\n')).toMatch(/NOT DELIVERED/);
    });

    it('with no ALERT_EMAIL the alert is still stored, and the missing configuration is visible - never a silent no-op', async () => {
        const r = await createAlerts({ db, sendMail: vi.fn(), log }).raise(critical);
        expect(r.delivered).toBe(false);
        expect((await alerts())[0].delivery_error).toBe('ALERT_EMAIL is not configured');
        expect(logs.join('\n')).toMatch(/ALERT_EMAIL/);
    });

    it('with an address but no mail transport, that is recorded too', async () => {
        await createAlerts({ db, alertEmail: 'ops@example.invalid', log }).raise(critical);
        expect((await alerts())[0].delivery_error).toBe('no mail transport is configured');
    });

    it('if the DATABASE is what failed, the alert cannot be stored: it is logged loudly and raise() still does not throw', async () => {
        const broken: Db = { query: async () => { throw new Error('connection refused'); } };
        const r = await createAlerts({ db: broken, sendMail: vi.fn(), alertEmail: 'ops@example.invalid', log }).raise(critical);
        expect(r).toEqual({ recorded: false, delivered: false });
        expect(logs.join('\n')).toMatch(/ALERT NOT RECORDED.*KSeF API down.*connection refused/);
    });

    it('escapes alert text in the HTML body (a client name or error message must not inject markup)', async () => {
        const sendMail = vi.fn().mockResolvedValue(undefined);
        await createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', log }).raise({ ...critical, subject: '<b>x</b>', message: '"><script>alert(1)</script>' });
        const html = sendMail.mock.calls[0][0].html as string;
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('SHADOW mode records nothing and sends nothing (a shadow run of a job must not e-mail clients or ops)', async () => {
        const sendMail = vi.fn().mockResolvedValue(undefined);
        const r = await createAlerts({ db, sendMail, alertEmail: 'ops@example.invalid', shadow: true, log }).raise(critical);
        expect(r).toEqual({ recorded: false, delivered: false });
        expect(sendMail).not.toHaveBeenCalled();
        expect(await alerts()).toEqual([]);
        expect(await audits()).toEqual([]);
        expect(logs.join('\n')).toMatch(/\[shadow\] would raise critical/);
    });
});
