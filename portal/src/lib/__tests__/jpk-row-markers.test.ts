import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeJpkMarkers, InvalidJpkMarkerError, GTU_CODES, PROCEDURE_CODES } from '../jpk-markers';
import { generateJpkV7M, type JpkInvoiceRow } from '../jpk-generator';

// Round 16: GTU_01..13 and the procedure markers on JPK_V7M(3) sales rows.
// Vocabulary comes from the MF broszura (styczeń 2026): SW/EE no longer exist
// (WSTO_EE replaced both) and there is no MPP row field.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1 })),
    requireRole: vi.fn(async () => null),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/entitlements', () => ({
    requireFeature: vi.fn(async () => null),
    requireActiveSubscription: vi.fn(async () => null),
}));
const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

const firm = { nip: '1234567890', name: 'Firm', taxOfficeCode: '1471', email: 'klient@example.com' };
const sale = (over: Partial<JpkInvoiceRow> = {}): JpkInvoiceRow => ({
    id: 1, invoice_number: 'S-1', issue_date: '2026-09-05', seller_name: 'Firm', buyer_name: 'B', buyer_nip: '1111111111',
    net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales', jpk_marker: 'OFF', ...over,
});

describe('normalizeJpkMarkers', () => {
    it('accepts every documented code', () => {
        const r = normalizeJpkMarkers({ gtu: [...GTU_CODES], procedures: [...PROCEDURE_CODES] });
        expect(r.gtu).toHaveLength(13);
        expect(r.procedures).toHaveLength(12);
    });
    it('dedupes and returns schema order', () => {
        expect(normalizeJpkMarkers({ gtu: ['GTU_04', 'GTU_01', 'GTU_04'] }).gtu).toEqual(['GTU_01', 'GTU_04']);
    });
    it('treats missing input as empty', () => {
        expect(normalizeJpkMarkers({})).toEqual({ gtu: [], procedures: [] });
    });
    it.each([['SW'], ['EE'], ['MPP'], ['GTU_14'], ['gtu_01'], [1]])('rejects %s', (bad) => {
        expect(() => normalizeJpkMarkers({ gtu: [bad] })).toThrow(InvalidJpkMarkerError);
        expect(() => normalizeJpkMarkers({ procedures: [bad] })).toThrow(InvalidJpkMarkerError);
    });
    it('rejects a non-array', () => {
        expect(() => normalizeJpkMarkers({ gtu: 'GTU_01' })).toThrow(InvalidJpkMarkerError);
    });
});

describe('generateJpkV7M row markers', () => {
    it('emits <tns:CODE>1</tns:CODE> in schema order, before the K_ fields', () => {
        const xml = generateJpkV7M(firm, '2026-09', [sale({ jpk_gtu: ['GTU_12', 'GTU_01'], jpk_procedures: ['TP', 'MR_UZ'] })]);
        const order = ['GTU_01', 'GTU_12', 'TP', 'MR_UZ', 'K_19'].map(c => xml.indexOf(`<tns:${c}>`));
        expect(order.every(i => i > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(xml).toContain('<tns:GTU_01>1</tns:GTU_01>');
        expect(xml).toContain('<tns:MR_UZ>1</tns:MR_UZ>');
    });
    it('omits every marker when none are set (optional fields stay empty)', () => {
        const xml = generateJpkV7M(firm, '2026-09', [sale(), sale({ id: 2, jpk_gtu: [], jpk_procedures: null })]);
        expect(xml).not.toMatch(/<tns:GTU_\d\d>/);
        expect(xml).not.toMatch(/<tns:(TP|IED|WSTO_EE|MR_T|MR_UZ)>/);
    });
    it('markers on one invoice do not leak onto another row', () => {
        const xml = generateJpkV7M(firm, '2026-09', [sale({ jpk_gtu: ['GTU_07'] }), sale({ id: 2, invoice_number: 'S-2' })]);
        expect((xml.match(/<tns:GTU_07>/g) || []).length).toBe(1);
    });
    it('never puts sales markers on purchase rows', () => {
        const xml = generateJpkV7M(firm, '2026-09', [sale({ id: 3, direction: 'purchase', jpk_marker: 'OFF', seller_nip: '2222222222', jpk_gtu: ['GTU_07'], jpk_procedures: ['TP'] })]);
        expect(xml).not.toContain('<tns:GTU_07>');
        expect(xml).not.toContain('<tns:TP>');
    });
    it('fails loudly on an unknown code instead of emitting it', () => {
        expect(() => generateJpkV7M(firm, '2026-09', [sale({ jpk_procedures: ['SW'] })])).toThrow(InvalidJpkMarkerError);
    });
});

describe('PATCH /api/invoices/[id]/jpk-markers', () => {
    beforeEach(() => queryMock.mockReset());
    const call = async (body: object) => {
        const { PATCH } = await import('@/app/api/invoices/[id]/jpk-markers/route');
        return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: '7' }) });
    };

    it('400s on an invalid code without touching the DB', async () => {
        const res = await call({ gtu: ['SW'] });
        expect(res.status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });
    it('404s for an invoice outside the firm (lookup is firm-scoped)', async () => {
        queryMock.mockResolvedValueOnce({ rows: [] });
        expect((await call({ gtu: ['GTU_01'] })).status).toBe(404);
        expect(queryMock.mock.calls[0][0]).toMatch(/firm_id = \$2/);
        expect(queryMock.mock.calls[0][1]).toEqual(['7', 1]);
    });
    it('400s for a purchase invoice', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'purchase', jpk_marker: 'OFF' }] });
        expect((await call({ gtu: ['GTU_01'] })).status).toBe(400);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });
    it('updates a sales invoice, scoped by firm', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'sales', jpk_marker: 'OFF' }] }).mockResolvedValueOnce({ rows: [] });
        const res = await call({ gtu: ['GTU_10'], procedures: ['TT_D'] });
        expect(res.status).toBe(200);
        const [sql, args] = queryMock.mock.calls[1];
        expect(sql).toMatch(/UPDATE invoices SET jpk_gtu = \$1, jpk_procedures = \$2, jpk_doc_type = \$3, jpk_import = \$4 WHERE id = \$5 AND firm_id = \$6/);
        expect(args).toEqual([['GTU_10'], ['TT_D'], null, false, '7', 1]);
    });
    it('sets TypDokumentu on a sales invoice, and refuses a purchase-only code there', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'sales' }] }).mockResolvedValueOnce({ rows: [] });
        expect((await call({ docType: 'FP' })).status).toBe(200);
        expect(queryMock.mock.calls[1][1]).toEqual([[], [], 'FP', false, '7', 1]);
        queryMock.mockClear();
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'sales' }] });
        expect((await call({ docType: 'MK' })).status).toBe(400);
        expect(queryMock).toHaveBeenCalledTimes(1); // lookup only, no UPDATE
    });
    it('sets DokumentZakupu and IMP on a purchase invoice; refuses GTU/procedures and IMP on the wrong side', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'purchase' }] }).mockResolvedValueOnce({ rows: [] });
        expect((await call({ docType: 'VAT_RR', import: true })).status).toBe(200);
        expect(queryMock.mock.calls[1][1]).toEqual([[], [], 'VAT_RR', true, '7', 1]);
        queryMock.mockClear();
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'purchase' }] });
        expect((await call({ gtu: ['GTU_01'] })).status).toBe(400);
        queryMock.mockClear();
        queryMock.mockResolvedValueOnce({ rows: [{ direction: 'sales' }] });
        expect((await call({ import: true })).status).toBe(400);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });
});

describe('migration 2026-09-19-jpk-row-markers.sql', () => {
    const ROOT = join(__dirname, '..', '..', '..', '..');
    let db: PGlite;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(readFileSync(join(ROOT, 'ksef-schema.sql'), 'utf8'));
        await db.exec(readFileSync(join(ROOT, 'migrations', '2026-09-19-jpk-row-markers.sql'), 'utf8'));
        // idempotent: a second application must not fail
        await db.exec(readFileSync(join(ROOT, 'migrations', '2026-09-19-jpk-row-markers.sql'), 'utf8'));
    });
    afterAll(async () => { await db.close(); });

    it('the CHECK constraints agree with jpk-markers.ts', async () => {
        const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='invoices' AND column_name IN ('jpk_gtu','jpk_procedures')`);
        expect(cols.rows).toHaveLength(2);
        const defs = await db.query<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname IN ('invoices_jpk_gtu_check','invoices_jpk_procedures_check')`);
        const text = defs.rows.map(r => r.def).join(' ');
        for (const c of [...GTU_CODES, ...PROCEDURE_CODES]) expect(text).toContain(`'${c}'`);
        expect(text).not.toMatch(/'(SW|EE|MPP)'/);
    });

    it('the database itself rejects retired/unknown codes', async () => {
        await db.exec(readFileSync(join(ROOT, 'ksef-schema-migration.sql'), 'utf8'));
        await db.exec(readFileSync(join(ROOT, 'ksef-schema-migration-v2.sql'), 'utf8'));
        await db.exec(readFileSync(join(ROOT, 'migrations', 'sprint9-13.sql'), 'utf8'));
        await db.exec(readFileSync(join(ROOT, 'migrations', '2026-09-13-tenancy-fix.sql'), 'utf8'));
        const firm = await db.query<{ id: number }>(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('F','f','f@x.pl','x') RETURNING id`);
        await db.query(`INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('1234567890', 'C', ${firm.rows[0].id}, 'token')`);
        const ins = (gtu: string, proc: string) => db.query(
            `INSERT INTO invoices (firm_id, client_nip, invoice_number, direction, jpk_gtu, jpk_procedures)
             VALUES (${firm.rows[0].id}, '1234567890', 'X-' || md5(random()::text), 'sales', '${gtu}', '${proc}')`);
        await expect(ins('{GTU_01,GTU_13}', '{TP,WSTO_EE}')).resolves.toBeDefined();
        await expect(ins('{GTU_14}', '{}')).rejects.toThrow();
        await expect(ins('{}', '{SW}')).rejects.toThrow();
        await expect(ins('{}', '{EE}')).rejects.toThrow();
    });
});
