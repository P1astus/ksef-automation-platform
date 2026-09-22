import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { invoiceRetrievalJob, type KsefPort, type MetadataPage } from '../jobs/invoice-retrieval';
import { buildJobs } from '../jobs/registry';
import { createAlerts } from '../jobs/alerts';
import type { Db } from '../jobs/queue';
import type { JobContext } from '../jobs/types';

// Port of workflows 04 + 02. KSeF is a scripted fake that records every request; the database is real Postgres (PGlite)
// on the real schema, because the guarantees under test (atomic rows+mark, unique key, compare-and-set) live in SQL.

let pg: PGlite;
let db: Db;
const D = 24 * 3_600_000;
const NOW = new Date('2026-09-21T10:00:00Z');
const T = (ms: number) => new Date(ms).toISOString();

interface Call { token: string; subject: string; from: string; to: string; offset: number }
function fakeKsef(script: (c: Call, n: number) => MetadataPage | Error) {
    const calls: Call[] = [];
    const port: KsefPort & { terminated: string[]; authenticated: string[] } = {
        terminated: [], authenticated: [],
        authenticate: vi.fn(async (nip: string) => { port.authenticated.push(nip); return `access-${nip}`; }),
        query: vi.fn(async (t, o) => {
            const c = { token: t, subject: o.subjectType, from: o.dateFrom, to: o.dateTo, offset: o.pageOffset };
            calls.push(c);
            const r = script(c, calls.length);
            if (r instanceof Error) throw r;
            return r;
        }),
        terminate: vi.fn(async (t: string) => { port.terminated.push(t); }),
    };
    return { port, calls };
}
const meta = (ksef: string, storage: string, over: any = {}) => ({
    ksefNumber: ksef, invoiceNumber: `FV/${ksef.slice(-4)}`, invoiceType: 'Vat', issueDate: '2026-09-15', acquisitionDate: storage,
    permanentStorageDate: storage, seller: { nip: '1111111111', name: 'Seller Sp. z o.o.' }, buyer: { identifier: { type: 'Nip', value: '2222222222' }, name: 'Buyer SA' },
    netAmount: 100, vatAmount: 23, grossAmount: 123, currency: 'PLN', ...over,
});
const num = (n: number, nip = '1111111111') => `${nip}-20260915-${n.toString(16).toUpperCase().padStart(6, '0')}-AB`;
const page = (invoices: any[], over: Partial<MetadataPage> = {}): MetadataPage => ({ invoices, hasMore: false, isTruncated: false, permanentStorageHwmDate: T(NOW.getTime() - 60_000), ...over });

const ctx = (over: Partial<JobContext> = {}): JobContext => ({
    db, now: () => NOW, shadow: false, signal: new AbortController().signal,
    alerts: createAlerts({ db, alertEmail: 'ops@example.invalid', sendMail: vi.fn().mockResolvedValue(undefined), log: () => {} }), log: () => {}, ...over,
});
const job = (port: KsefPort, over: any = {}) => invoiceRetrievalJob({ ksef: port, decryptToken: (s: string) => `token:${s}`, ...over });

async function firm(n: string, over: { active?: boolean; status?: string } = {}) {
    return (await pg.query<any>(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash, is_active, subscription_status)
        VALUES ($1::text, $1::text, $1::text || '@x.invalid', 'x', $2, $3) RETURNING id`, [n, over.active ?? true, over.status ?? 'trial'])).rows[0].id as number;
}
async function client(firmId: number, nip: string, over: { hwm_sales?: string | null; hwm_purchases?: string | null; token?: string | null; sync?: boolean; auth?: string } = {}) {
    return (await pg.query<any>(
        `INSERT INTO clients (firm_id, nip, client_name, auth_method, ksef_token_encrypted, sync_enabled, hwm_sales, hwm_purchases)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [firmId, nip, `Client ${nip}`, over.auth ?? 'token', over.token === undefined ? 'stored' : over.token, over.sync ?? true,
            over.hwm_sales === undefined ? T(NOW.getTime() - D) : over.hwm_sales, over.hwm_purchases === undefined ? T(NOW.getTime() - D) : over.hwm_purchases])).rows[0].id as number;
}
const marks = async (id: number) => (await pg.query<any>('SELECT hwm_sales, hwm_purchases, last_sync_success, last_sync_error FROM clients WHERE id = $1', [id])).rows[0];
const invoices = async () => (await pg.query<any>('SELECT * FROM invoices ORDER BY ksef_number')).rows;
const ms = (d: Date | string | null) => (d ? new Date(d).getTime() : null);

beforeEach(async () => {
    pg = new PGlite();
    await applyCurrentSchema(pg);
    db = { query: (t, p) => pg.query(t, p as any[]) as any };
});

describe('invoice-retrieval: what is stored', () => {
    it('is registered on the workflow\'s 30-minute schedule', () => {
        const j = buildJobs({}).find(x => x.name === 'invoice-retrieval')!;
        expect(j.schedule).toEqual({ kind: 'every', minutes: 30 });
    });

    it('stores sales and purchases with direction, fields and the NrKSeF marker; advances each mark to KSeF\'s watermark', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const salesHwm = T(NOW.getTime() - 5 * 60_000);
        const purHwm = T(NOW.getTime() - 7 * 60_000);
        const { port } = fakeKsef(c => c.subject === 'Subject1'
            ? page([meta(num(1), T(NOW.getTime() - 3600_000))], { permanentStorageHwmDate: salesHwm })
            : page([meta(num(2), T(NOW.getTime() - 3600_000), { seller: { nip: '9999999999', name: 'Vendor' }, buyer: { identifier: { type: 'Nip', value: '1111111111' } } })], { permanentStorageHwmDate: purHwm }));
        const r = await job(port).run(ctx());
        expect(r.failures).toEqual([]);
        const rows = await invoices();
        expect(rows).toHaveLength(2);
        expect(rows.find(x => x.direction === 'sales')).toMatchObject({
            firm_id: f, client_nip: '1111111111', ksef_number: num(1), invoice_type: 'Vat', jpk_marker: 'NrKSeF', jpk_period: '2026-09',
            seller_nip: '1111111111', buyer_nip: '2222222222', seller_name: 'Seller Sp. z o.o.', currency: 'PLN',
        });
        expect(Number(rows.find(x => x.direction === 'sales').gross_amount)).toBe(123);
        expect(rows.find(x => x.direction === 'purchase')).toMatchObject({ seller_nip: '9999999999', buyer_nip: '1111111111' });
        const m = await marks(id);
        expect(ms(m.hwm_sales)).toBe(ms(salesHwm));
        expect(ms(m.hwm_purchases)).toBe(ms(purHwm));   // separate marks
        expect(m.last_sync_success).not.toBeNull();
        expect(m.last_sync_error).toBeNull();
    });

    it('the mark is KSeF\'s watermark, NOT the wall clock: an invoice stored while we read is not skipped', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const wm = T(NOW.getTime() - 20 * 60_000);
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: wm }));
        await job(port).run(ctx({ now: () => NOW }));
        expect(ms((await marks(id)).hwm_sales)).toBe(ms(wm));
        expect(ms((await marks(id)).hwm_sales)).toBeLessThan(NOW.getTime());
    });

    it('the window end is captured BEFORE the query (the clock moving during the read does not widen it)', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        let t = NOW.getTime();
        const { port, calls } = fakeKsef(() => { t += 10 * 60_000; return page([], { permanentStorageHwmDate: T(NOW.getTime() - 60_000) }); });
        await job(port).run(ctx({ now: () => new Date(t) }));
        expect(calls[0].to).toBe(T(NOW.getTime()));
    });

    it('first sync (no mark) reads the last 7 days, like the workflow', async () => {
        const f = await firm('a'); await client(f, '1111111111', { hwm_sales: null, hwm_purchases: null });
        const { port, calls } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime()) }));
        await job(port).run(ctx());
        expect(calls[0].from).toBe(T(NOW.getTime() - 7 * D));
    });

    it.each([undefined, 'not-a-date'])('refuses an absent or invalid server watermark (%s)', async (watermark) => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const before = await marks(id);
        const { port } = fakeKsef(() => page([meta(num(1), T(NOW.getTime() - 3600_000))], { permanentStorageHwmDate: watermark }));
        const result = await job(port).run(ctx());
        expect(result.failures).toHaveLength(1);
        expect((await marks(id)).hwm_sales).toEqual(before.hwm_sales);
        expect(await invoices()).toEqual([]);
    });

    it('does not treat hasMore=false as complete when isTruncated=true', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const before = await marks(id);
        const { port } = fakeKsef(() => page([], { hasMore: false, isTruncated: true }));
        const result = await job(port).run(ctx());
        expect(result.failures).toHaveLength(1);
        expect((await marks(id)).hwm_sales).toEqual(before.hwm_sales);
    });

    it('does not commit when the lease is lost during the final network read', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const before = await marks(id);
        const controller = new AbortController();
        const { port } = fakeKsef(() => {
            controller.abort();
            return page([meta(num(1), T(NOW.getTime() - 3600_000))]);
        });
        await job(port).run(ctx({ signal: controller.signal })).catch(() => {});
        expect((await marks(id)).hwm_sales).toEqual(before.hwm_sales);
        expect(await invoices()).toEqual([]);
    });
});

describe('invoice-retrieval: the mark is never ahead of the rows', () => {
    it('a failure on page 2 stores nothing for that direction and leaves its mark where it was; the other direction still runs', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const before = await marks(id);
        const { port } = fakeKsef((c) => {
            if (c.subject === 'Subject1') return c.offset === 0 ? page([meta(num(1), T(NOW.getTime() - 3600_000))], { hasMore: true }) : new Error('KSeF 500');
            return page([meta(num(2), T(NOW.getTime() - 3600_000))], { permanentStorageHwmDate: T(NOW.getTime() - 60_000) });
        });
        const r = await job(port).run(ctx());
        expect(r.failures).toHaveLength(1);
        expect(r.failures![0].error).toContain('sales: KSeF 500');
        expect((await invoices()).map(x => x.direction)).toEqual(['purchase']);   // nothing from the half-read sales window
        const m = await marks(id);
        expect(ms(m.hwm_sales)).toBe(ms(before.hwm_sales));
        expect(ms(m.hwm_purchases)).toBeGreaterThan(ms(before.hwm_purchases)!);
        expect(m.last_sync_error).toContain('KSeF 500');
        expect(port.terminated).toEqual(['access-1111111111']);                  // session closed even on failure
    });

    it('follows hasMore pages by pageOffset and commits once, at the end', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const pages = [
            page([meta(num(1), T(NOW.getTime() - 3 * 3600_000))], { hasMore: true }),
            page([meta(num(2), T(NOW.getTime() - 2 * 3600_000))], { hasMore: true }),
            page([meta(num(3), T(NOW.getTime() - 3600_000))], { permanentStorageHwmDate: T(NOW.getTime() - 60_000) }),
        ];
        const { port, calls } = fakeKsef((c) => c.subject === 'Subject1' ? pages[c.offset] : page([]));
        await job(port).run(ctx());
        expect(calls.filter(c => c.subject === 'Subject1').map(c => c.offset)).toEqual([0, 1, 2]);
        expect((await invoices()).filter(x => x.direction === 'sales')).toHaveLength(3);
        expect(ms((await marks(id)).hwm_sales)).toBe(NOW.getTime() - 60_000);
    });

    it('isTruncated: narrows from the last record, resets the page, and only then moves the mark', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111', { hwm_sales: T(NOW.getTime() - 2 * D) });
        const lastOfFirst = T(NOW.getTime() - D);
        const { port, calls } = fakeKsef((c) => {
            if (c.subject !== 'Subject1') return page([]);
            if (c.from === T(NOW.getTime() - 2 * D)) return page([meta(num(1), T(NOW.getTime() - 1.5 * D)), meta(num(2), lastOfFirst)], { hasMore: true, isTruncated: true });
            return page([meta(num(2), lastOfFirst), meta(num(3), T(NOW.getTime() - 3600_000))], { permanentStorageHwmDate: T(NOW.getTime() - 60_000) });
        });
        await job(port).run(ctx());
        const sales = calls.filter(c => c.subject === 'Subject1');
        expect(sales.map(c => [c.from, c.offset])).toEqual([[T(NOW.getTime() - 2 * D), 0], [lastOfFirst, 0]]);
        expect((await invoices()).filter(x => x.direction === 'sales').map(x => x.ksef_number)).toEqual([num(1), num(2), num(3)]); // overlap deduped
        expect(ms((await marks(id)).hwm_sales)).toBe(NOW.getTime() - 60_000);
    });

    it('a truncation that cannot be narrowed FAILS the client: nothing stored, mark unmoved', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const before = await marks(id);
        const sameInstant = ms(before.hwm_sales)!;
        const { port } = fakeKsef((c) => c.subject === 'Subject1'
            ? page([meta(num(1), T(sameInstant))], { hasMore: true, isTruncated: true })
            : page([]));
        const r = await job(port).run(ctx());
        expect(r.failures![0].error).toMatch(/truncated .* cannot be narrowed/);
        expect((await invoices()).filter(x => x.direction === 'sales')).toEqual([]);
        expect(ms((await marks(id)).hwm_sales)).toBe(ms(before.hwm_sales));
    });

    it('a stale compare-and-set (the mark moved under us) stores the rows but does not clobber the newer mark', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const newer = T(NOW.getTime() - 60_000);
        const { port } = fakeKsef((c) => {
            if (c.subject === 'Subject1') {
                // someone else advances the mark while we are reading
                return page([meta(num(1), T(NOW.getTime() - 3600_000))], { permanentStorageHwmDate: T(NOW.getTime() - 30 * 60_000) });
            }
            return page([]);
        });
        const original = db.query.bind(db);
        db.query = async (t, p) => {
            if (t.includes('hwm_sales = $4')) await pg.query('UPDATE clients SET hwm_sales = $1 WHERE id = $2', [newer, id]);
            return original(t, p);
        };
        await job(port).run(ctx());
        expect((await invoices()).filter(x => x.direction === 'sales')).toHaveLength(1);
        expect(ms((await marks(id)).hwm_sales)).toBe(ms(newer));
    });

    it('a legacy mark with microseconds (written by n8n\'s NOW()) still advances - the CAS compares at millisecond precision', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        await pg.query(`UPDATE clients SET hwm_sales = '2026-09-20 09:00:00.123456+00', hwm_purchases = '2026-09-20 09:00:00.123456+00' WHERE id = $1`, [id]);
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime() - 60_000) }));
        await job(port).run(ctx());
        expect(ms((await marks(id)).hwm_sales)).toBe(NOW.getTime() - 60_000);
    });
});

describe('invoice-retrieval: windows and dedup', () => {
    it('a mark older than 3 months is read in windows of at most 89 days, each committed as it completes', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111', { hwm_sales: T(NOW.getTime() - 200 * D), hwm_purchases: T(NOW.getTime() - 1 * D) });
        const { port, calls } = fakeKsef((c) => page([], { permanentStorageHwmDate: c.to }));
        await job(port).run(ctx());
        const sales = calls.filter(c => c.subject === 'Subject1');
        expect(sales.length).toBe(3);
        for (const c of sales) expect(new Date(c.to).getTime() - new Date(c.from).getTime()).toBeLessThanOrEqual(89 * D);
        expect(sales[1].from).toBe(sales[0].to);
        expect(sales[2].to).toBe(T(NOW.getTime()));
        expect(ms((await marks(id)).hwm_sales)).toBe(NOW.getTime());
    });

    it('progress in an earlier window survives a failure in a later one', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111', { hwm_sales: T(NOW.getTime() - 200 * D) });
        const firstEnd = NOW.getTime() - 200 * D + 89 * D;
        const { port } = fakeKsef((c, n) => c.subject === 'Subject1' && n === 2 ? new Error('boom') : page([], { permanentStorageHwmDate: c.to }));
        const r = await job(port).run(ctx());
        expect(r.failures).toHaveLength(1);
        expect(ms((await marks(id)).hwm_sales)).toBe(firstEnd);
    });

    it('re-running with the same data inserts nothing new (unique key + ON CONFLICT DO NOTHING) and reports it', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const { port } = fakeKsef((c) => c.subject === 'Subject1' ? page([meta(num(1), T(NOW.getTime() - 3600_000)), meta(num(1), T(NOW.getTime() - 3600_000))]) : page([]));
        await job(port).run(ctx());
        await pg.query(`UPDATE clients SET hwm_sales = $1`, [T(NOW.getTime() - D)]);
        const r = await job(port).run(ctx());
        expect(await invoices()).toHaveLength(1);
        expect((r.detail as any).perClient[0].outcomes[0]).toMatchObject({ fetched: 1, inserted: 0 });
    });

    it('one KSeF invoice between two clients of the SAME firm is stored for both (a sale and a purchase)', async () => {
        // Post-contract schema: only UNIQUE (firm_id, client_nip, ksef_number) remains (db/contract/...).
        await pg.query('ALTER TABLE invoices DROP CONSTRAINT invoices_ksef_number_key');
        const f = await firm('a');
        await client(f, '1111111111'); await client(f, '2222222222');
        const shared = meta(num(7), T(NOW.getTime() - 3600_000)); // seller 1111111111, buyer 2222222222
        // KSeF shows it to the seller as Subject1 and to the buyer as Subject2, and to nobody else.
        const { port } = fakeKsef((c) => (c.token === 'access-1111111111' && c.subject === 'Subject1') || (c.token === 'access-2222222222' && c.subject === 'Subject2') ? page([shared]) : page([]));
        await job(port, {}).run(ctx());
        const rows = await invoices();
        expect(rows.filter(x => x.ksef_number === num(7)).map(x => `${x.client_nip}:${x.direction}`).sort())
            .toEqual(['1111111111:sales', '2222222222:purchase']);
    });

    it('a KSeF number another firm already stores fails loudly (never silently dropped) while the old global unique exists', async () => {
        const a = await firm('a'); const b = await firm('b');
        await client(a, '1111111111', { sync: false }); await client(b, '1111111111');
        await pg.query(`INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction) VALUES ($1, '1111111111', $2, 'FV/1', 'sales')`, [a, num(1)]);
        const { port } = fakeKsef((c) => c.subject === 'Subject1' ? page([meta(num(1), T(NOW.getTime() - 3600_000))]) : page([]));
        const r = await job(port).run(ctx());
        expect(r.failures).toHaveLength(1);
        expect(r.failures![0].error).toMatch(/unique|duplicate/i);
    });
});

describe('invoice-retrieval: clients, credentials and shadow', () => {
    it('excludes deactivated and canceled firms without KSeF calls, failures or alerts', async () => {
        const active = await firm('eligible', { status: 'active' });
        const deactivated = await firm('deactivated', { active: false, status: 'active' });
        const canceled = await firm('canceled', { status: 'canceled' });
        await client(active, '1111111111');
        await client(deactivated, '3333333333');
        await client(canceled, '5555555555');
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime() - 1000) }));
        const log = vi.fn();
        const result = await job(port).run(ctx({ log }));
        expect(port.authenticated).toEqual(['1111111111']);
        expect(result).toMatchObject({ processed: 1, failures: [], detail: { clients: 1, excluded: 2 } });
        expect(log).toHaveBeenCalledWith('invoice-retrieval: excluded 2 client(s) belonging to inactive firms');
        expect((await pg.query<any>('SELECT count(*)::int n FROM system_alerts')).rows[0].n).toBe(0);
    });

    it('manual client scope runs even when scheduled sync is disabled, without reading another firm', async () => {
        const ownFirm = await firm('manual-own');
        const otherFirm = await firm('manual-other');
        const manualId = await client(ownFirm, '1111111111', { sync: false });
        await client(otherFirm, '3333333333', { sync: false });
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime() - 1000) }));
        const scheduled = await job(port).run(ctx());
        expect(scheduled.detail).toMatchObject({ clients: 0 });
        const manual = await job(port).run({ ...ctx(), payload: { clientId: manualId, firmId: ownFirm } } as any);
        expect(manual.detail).toMatchObject({ clients: 1 });
        expect(port.authenticated).toEqual(['1111111111']);
    });

    it('only sync-enabled clients are read; a scoped run (payload) reads just that client', async () => {
        const f = await firm('a');
        const c1 = await client(f, '1111111111'); await client(f, '3333333333'); await client(f, '4444444444', { sync: false });
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime() - 1000) }));
        await job(port).run(ctx());
        expect(port.authenticated.sort()).toEqual(['1111111111', '3333333333']);
        port.authenticated.length = 0;
        await job(port).run({ ...ctx(), payload: { clientId: c1 } } as any);
        expect(port.authenticated).toEqual(['1111111111']);
    });

    it('a client with no token is a clear per-client failure and does not stop the others', async () => {
        const f = await firm('a');
        await client(f, '1111111111', { token: null }); await client(f, '3333333333', { token: null, auth: 'certificate' }); await client(f, '5555555555');
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime() - 1000) }));
        const r = await job(port).run(ctx());
        expect(r.failures!.map(x => x.error)).toEqual([
            'no KSeF token is configured for this client',
        ]);
        expect(r.processed).toBe(1);
    });

    it('certificate credentials are a persistent visible status, never a token or repeated alert', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111', { auth: 'certificate', token: 'encrypted-pkcs12' });
        const { port } = fakeKsef(() => page([]));
        const queries: string[] = [];
        const recording: Db = { query: async (sql, params) => { queries.push(sql); return db.query(sql, params); } };
        for (let i = 0; i < 2; i++) {
            const result = await job(port).run(ctx({ db: recording }));
            expect(result).toMatchObject({ processed: 0, skipped: 1, failures: [] });
        }
        expect(port.authenticate).not.toHaveBeenCalled();
        expect((await marks(id)).last_sync_error).toContain('certificate');
        expect((await marks(id)).last_sync_success).toBeNull();
        expect(queries.filter(sql => sql.includes('UPDATE clients'))).toHaveLength(1);
    });

    it('certificate status is not written in shadow', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111', { auth: 'certificate' });
        const { port } = fakeKsef(() => page([]));
        const result = await job(port).run(ctx({ shadow: true }));
        expect(result).toMatchObject({ skipped: 1, failures: [] });
        expect((await marks(id)).last_sync_error).toBeNull();
        expect(port.authenticate).not.toHaveBeenCalled();
    });

    it('an authentication failure is a per-client failure that names the client, recorded on the client', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        const { port } = fakeKsef(() => page([]));
        (port.authenticate as any).mockRejectedValueOnce(new Error('KSeF auth/ksef-token failed (401)'));
        const r = await job(port).run(ctx());
        expect(r.failures![0]).toMatchObject({ firmId: f, clientNip: '1111111111' });
        expect((await marks(id)).last_sync_error).toContain('401');
    });

    it('a missing credentials key aborts the whole run (one misconfiguration), not one failure per client', async () => {
        const f = await firm('a'); await client(f, '1111111111'); await client(f, '3333333333');
        const { port } = fakeKsef(() => page([]));
        const missing = Object.assign(new Error('KSEF_CREDENTIALS_KEY is not configured'), { name: 'MissingCredentialKeyError' });
        await expect(job(port, { decryptToken: () => { throw missing; } }).run(ctx())).rejects.toThrow(/KSEF_CREDENTIALS_KEY/);
        expect(port.authenticated).toEqual([]);
    });

    it('a bad ciphertext for one client fails that client only', async () => {
        const f = await firm('a'); await client(f, '1111111111'); await client(f, '3333333333');
        const { port } = fakeKsef(() => page([], { permanentStorageHwmDate: T(NOW.getTime() - 1000) }));
        let n = 0;
        const r = await job(port, { decryptToken: (s: string) => { if (n++ === 0) throw new Error('Unsupported state or unable to authenticate data'); return s; } }).run(ctx());
        expect(r.failures).toHaveLength(1);
        expect(r.processed).toBe(1);
    });

    it('SHADOW: reads KSeF, reports what it would insert, and writes NOTHING (no rows, no mark, no status, no alert)', async () => {
        const f = await firm('a'); const id = await client(f, '1111111111');
        await pg.query(`INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction) VALUES ($1, '1111111111', $2, 'FV/old', 'sales')`, [f, num(1)]);
        const before = await marks(id);
        const { port } = fakeKsef((c) => c.subject === 'Subject1'
            ? page([meta(num(1), T(NOW.getTime() - 3600_000)), meta(num(2), T(NOW.getTime() - 1800_000))], { permanentStorageHwmDate: T(NOW.getTime() - 60_000) })
            : page([]));
        const r = await job(port).run(ctx({ shadow: true }));
        expect(r.failures).toEqual([]);
        expect((r.detail as any).perClient[0].outcomes[0]).toMatchObject({ direction: 'sales', fetched: 2, inserted: 1 });
        expect(await invoices()).toHaveLength(1);
        expect(await marks(id)).toEqual(before);
        expect((await pg.query<any>('SELECT count(*)::int n FROM system_alerts')).rows[0].n).toBe(0);
    });

    it('honours an aborted signal instead of starting another client', async () => {
        const f = await firm('a'); await client(f, '1111111111');
        const ac = new AbortController(); ac.abort();
        const { port } = fakeKsef(() => page([]));
        await expect(job(port).run(ctx({ signal: ac.signal }))).rejects.toThrow(/aborted/);
        expect(port.authenticated).toEqual([]);
    });
});
