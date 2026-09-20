import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcryptjs';

// Round 16: vendor/admin console. The properties that matter: a tenant
// session can never act as an operator (or the reverse), a deactivated
// operator loses access at once, logins are throttled and audited, every
// console page enforces the session itself, and the data queries expose
// counts/metadata only.

process.env.JWT_SECRET = 'test-secret-for-operator-console';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (n: string) => (cookieJar.has(n) ? { value: cookieJar.get(n) } : undefined),
        set: (n: string, v: string) => { cookieJar.set(n, v); },
    }),
    headers: async () => ({ get: (n: string) => (n === 'x-real-ip' ? '203.0.113.9' : n === 'x-forwarded-for' ? '198.51.100.8, 10.0.0.1' : null) }),
}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
const queryMock = vi.fn(async (..._a: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...a: any[]) => queryMock(...a) }));
vi.mock('../db', () => ({ query: (...a: any[]) => queryMock(...a) }));

import * as op from '../operator-auth';
import { encrypt as firmEncrypt, decrypt as firmDecrypt } from '../auth';
import { applyBaseline } from './helpers/baseline';

beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue({ rows: [] }); cookieJar.clear(); op._resetThrottleForTests(); });

describe('token isolation', () => {
    it('an operator token is not a valid firm session, and a firm session is not an operator token', async () => {
        const operatorToken = await op.signOperatorToken(1, 'o@x.pl');
        await expect(firmDecrypt(operatorToken)).rejects.toThrow();

        const firmToken = await firmEncrypt({ firmId: 1, adminEmail: 'o@x.pl', role: 'owner', userId: null, operatorId: 1, email: 'o@x.pl' });
        expect(await op.verifyOperatorToken(firmToken)).toBeNull();
        expect(await op.verifyOperatorToken(operatorToken)).toEqual({ operatorId: 1, email: 'o@x.pl' });
    });
    it('rejects garbage and tampered tokens', async () => {
        expect(await op.verifyOperatorToken('nope')).toBeNull();
        const t = await op.signOperatorToken(1, 'o@x.pl');
        expect(await op.verifyOperatorToken(t.slice(0, -3) + 'aaa')).toBeNull();
    });
});

describe('getOperatorSession', () => {
    it('is null without a cookie', async () => {
        expect(await op.getOperatorSession()).toBeNull();
        expect(queryMock).not.toHaveBeenCalled();
    });
    it('is valid only while operators.is_active is true (checked on every call)', async () => {
        cookieJar.set(op.OPERATOR_COOKIE, await op.signOperatorToken(7, 'o@x.pl'));
        queryMock.mockResolvedValueOnce({ rows: [{ is_active: true }] });
        expect(await op.getOperatorSession()).toEqual({ operatorId: 7, email: 'o@x.pl' });
        queryMock.mockResolvedValueOnce({ rows: [{ is_active: false }] });
        expect(await op.getOperatorSession()).toBeNull();
        queryMock.mockResolvedValueOnce({ rows: [] });
        expect(await op.getOperatorSession()).toBeNull();
    });
    it('fails closed (throws) on a DB error instead of granting access', async () => {
        cookieJar.set(op.OPERATOR_COOKIE, await op.signOperatorToken(7, 'o@x.pl'));
        queryMock.mockRejectedValueOnce(new Error('db down'));
        await expect(op.getOperatorSession()).rejects.toThrow('db down');
    });
    it('requireOperator redirects to the login page when unauthenticated', async () => {
        await expect(op.requireOperator()).rejects.toThrow('REDIRECT:/admin/login');
    });
});

describe('verifyOperatorLogin', () => {
    const hash = bcrypt.hashSync('correct horse battery', 4);
    it('accepts the right password (case-insensitive email) and stamps last_login_at', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ id: 3, password_hash: hash, is_active: true }] });
        const r = await op.verifyOperatorLogin(' O@X.pl ', 'correct horse battery');
        expect(r).toEqual({ ok: true, operatorId: 3, email: 'o@x.pl' });
        expect(queryMock.mock.calls[0][1]).toEqual(['o@x.pl']);
        expect(queryMock.mock.calls[1][0]).toMatch(/UPDATE operators SET last_login_at/);
    });
    it.each([
        ['wrong password', [{ id: 3, password_hash: hash, is_active: true }], 'wrong'],
        ['unknown email', [], 'correct horse battery'],
        ['deactivated operator with the right password', [{ id: 3, password_hash: hash, is_active: false }], 'correct horse battery'],
    ])('rejects: %s', async (_n, rows, pw) => {
        queryMock.mockResolvedValueOnce({ rows });
        expect(await op.verifyOperatorLogin('o@x.pl', pw)).toEqual({ ok: false, reason: 'invalid' });
    });
    it('throttles after 5 failures, even for the correct password', async () => {
        for (let i = 0; i < 5; i++) {
            queryMock.mockResolvedValueOnce({ rows: [{ id: 3, password_hash: hash, is_active: true }] });
            await op.verifyOperatorLogin('o@x.pl', 'bad');
        }
        expect(await op.verifyOperatorLogin('o@x.pl', 'correct horse battery')).toEqual({ ok: false, reason: 'throttled' });
        // another operator from a different peer is unaffected
        queryMock.mockResolvedValueOnce({ rows: [{ id: 4, password_hash: hash, is_active: true }] });
        expect((await op.verifyOperatorLogin('other@x.pl', 'correct horse battery', '192.0.2.11')).ok).toBe(true);
    });
    it('applies a shared IP limit across addresses, so changing the target email cannot evade it', async () => {
        for (let i = 0; i < 5; i++) {
            queryMock.mockResolvedValueOnce({ rows: [] });
            await op.verifyOperatorLogin(`operator${i}@x.pl`, 'bad', '192.0.2.10');
        }
        expect(await op.verifyOperatorLogin('fresh@x.pl', 'correct horse battery', '192.0.2.10')).toEqual({ ok: false, reason: 'throttled' });
    });
    it('failures expire after the window', () => {
        const t0 = 1_000_000;
        for (let i = 0; i < 5; i++) op.recordFailure('k', t0);
        expect(op.isThrottled('k', t0 + 1000)).toBe(true);
        expect(op.isThrottled('k', t0 + 16 * 60 * 1000)).toBe(false);
    });
});

describe('POST /api/admin/login', () => {
    const hash = bcrypt.hashSync('correct horse battery', 4);
    const post = async (body: object) => {
        const { POST } = await import('@/app/api/admin/login/route');
        return POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
    };
    it('401s a bad login, audits it without an operator id, sets no cookie', async () => {
        queryMock.mockResolvedValueOnce({ rows: [] });
        const res = await post({ email: 'X@y.pl', password: 'whatever12345' });
        expect(res.status).toBe(401);
        expect(cookieJar.has(op.OPERATOR_COOKIE)).toBe(false);
        const audit = queryMock.mock.calls.find(c => /INSERT INTO operator_audit_log/.test(c[0]))!;
        expect(audit[1].slice(0, 5)).toEqual([null, 'x@y.pl', 'login_failed', null, '203.0.113.9']);
    });
    it('sets the operator cookie and audits a good login', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ id: 3, password_hash: hash, is_active: true }] });
        const res = await post({ email: 'o@x.pl', password: 'correct horse battery' });
        expect(res.status).toBe(200);
        expect(await op.verifyOperatorToken(cookieJar.get(op.OPERATOR_COOKIE)!)).toEqual({ operatorId: 3, email: 'o@x.pl' });
        const audit = queryMock.mock.calls.find(c => /INSERT INTO operator_audit_log/.test(c[0]))!;
        expect(audit[1][2]).toBe('login');
    });
    it('400s missing fields', async () => {
        expect((await post({ email: 'o@x.pl' })).status).toBe(400);
    });
});

describe('every console page enforces the operator session itself', () => {
    const root = join(__dirname, '..', '..', 'app', 'admin', '(console)');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const files = walk(root).filter(f => /(page|layout)\.tsx$/.test(f));
    it('finds the console files', () => expect(files.length).toBeGreaterThanOrEqual(3));
    it.each(files.map(f => [f.slice(root.length)]))('%s calls requireOperator()', (rel) => {
        const src = readFileSync(join(root, rel as string), 'utf8');
        expect(src).toMatch(/await requireOperator\(\)/);
        // ...and does so before any data access
        const guard = src.indexOf('requireOperator()');
        for (const dataCall of ['listFirms(', 'fleetTotals(', 'getFirmDetail(', 'auditOperator(']) {
            const i = src.indexOf(`await ${dataCall}`);
            if (i !== -1) expect(guard).toBeLessThan(i);
            const j = src.indexOf(`${dataCall}`, src.indexOf('export default'));
            if (j !== -1) expect(guard).toBeLessThan(j);
        }
    });
});

describe('admin-data against the real schema', () => {
    const ROOT = join(__dirname, '..', '..', '..', '..');
    let db: PGlite;
    let a: number; let b: number;
    beforeAll(async () => {
        db = new PGlite();
        await applyBaseline(db);
        // idempotent
        await db.exec(readFileSync(join(ROOT, 'migrations/2026-09-19-operators.sql'), 'utf8'));
        a = (await db.query<{ id: number }>(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Quiet', 'quiet', 'q@x.pl', 'SECRETHASH') RETURNING id`)).rows[0].id;
        b = (await db.query<{ id: number }>(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Late', 'late', 'l@x.pl', 'SECRETHASH') RETURNING id`)).rows[0].id;
        for (const [f, nip] of [[a, '1111111111'], [b, '2222222222']] as const) {
            await db.query(`INSERT INTO clients (nip, client_name, firm_id, auth_method, last_sync_error) VALUES ($1, 'C', $2, 'token', ${f === b ? "'boom'" : 'NULL'})`, [nip, f]);
        }
        await db.query(`INSERT INTO offline_invoices (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline) VALUES
            (${b}, '2222222222', 'OVER', 'offline24', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 hour'),
            (${b}, '2222222222', 'SOON', 'offline24', NOW(), NOW() + INTERVAL '5 hours')`);
        const { rows } = await db.query<{ id: number }>('SELECT id FROM firms LIMIT 0');
        void rows;
    });
    afterAll(async () => { await db.close(); });

    beforeEach(() => { queryMock.mockImplementation(async (sql: string, params?: any[]) => db.query(sql, params) as any); });

    it('lists firms with overdue offline24 first and correct counts', async () => {
        const { listFirms } = await import('../admin-data');
        const firms = await listFirms();
        expect(firms.map(f => f.firm_name)).toEqual(['Late', 'Quiet']);
        expect(firms[0]).toMatchObject({ clients: 1, offline_open: 2, offline_overdue: 1, clients_sync_errors: 1 });
        expect(firms[1]).toMatchObject({ offline_open: 0, offline_overdue: 0, clients_sync_errors: 0 });
    });
    it('fleet totals aggregate across firms', async () => {
        const { fleetTotals } = await import('../admin-data');
        expect(await fleetTotals()).toMatchObject({ firms: 2, active_firms: 2, clients: 2, offline_overdue: 1 });
    });
    it('lists the newest operator-audit metadata without exposing tenant data', async () => {
        await db.query(`INSERT INTO operator_audit_log (operator_email, action, firm_id, ip, details) VALUES ('o@x.pl', 'view_firm', $1, '192.0.2.1', '{"source":"console"}')`, [a]);
        const { listOperatorAudit } = await import('../admin-data');
        const entries = await listOperatorAudit();
        expect(entries[0]).toMatchObject({ operator_email: 'o@x.pl', action: 'view_firm', firm_id: a, ip: '192.0.2.1' });
    });
    it('firm detail is scoped to the requested firm and null for an unknown id', async () => {
        const { getFirmDetail } = await import('../admin-data');
        const d = (await getFirmDetail(b))!;
        expect(d.clients).toHaveLength(1);
        expect(d.offlineQueue.map(o => o.invoice_number)).toEqual(['OVER', 'SOON']);
        expect(await getFirmDetail(999999)).toBeNull();
    });
    it('never returns credentials or tokens', async () => {
        const { listFirms, getFirmDetail } = await import('../admin-data');
        const data = [await listFirms(), await getFirmDetail(a)];
        expect(JSON.stringify(data)).not.toContain('SECRETHASH');
        // field NAMES (a client's auth_method *value* may legitimately be 'token')
        const keys = new Set<string>();
        const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
        walk(data);
        expect([...keys].filter(k => /password|hash|token|stripe|reset|encrypted|raw_xml/i.test(k))).toEqual([]);
    });
    it('the audit table accepts a failed-login row with no operator', async () => {
        await expect(db.query(`INSERT INTO operator_audit_log (operator_id, operator_email, action) VALUES (NULL, 'x@y.pl', 'login_failed')`)).resolves.toBeDefined();
    });
});
