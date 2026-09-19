import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// Round 7: invoices.processing_status had no distinct "sent to KSeF" or
// "rejected by KSeF" state - see migrations/2026-09-16-invoice-status-
// vocabulary.sql. Two things to prove: the widened CHECK constraint against
// a real Postgres-compatible engine, and that jpk/generate/route.ts's new
// "mark these invoices exported_jpk" step never overwrites a 'rejected' or
// 'error' invoice - the whole point of adding 'rejected' is to keep a real
// KSeF refusal visible, not have it silently vanish into "exported".

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('processing_status CHECK constraint (real Postgres engine, not mocked)', () => {
    let db: PGlite;
    let firmId: number;

    beforeAll(async () => {
        db = new PGlite();
        for (const file of [
            'ksef-schema.sql',
            'ksef-schema-migration.sql',
            'ksef-schema-migration-v2.sql',
            join('migrations', 'sprint9-13.sql'),
            join('migrations', '2026-09-13-tenancy-fix.sql'),
            join('migrations', '2026-09-16-invoice-status-vocabulary.sql'),
        ]) {
            await db.exec(readFileSync(join(ROOT, file), 'utf8'));
        }
        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x') RETURNING id`
        );
        firmId = firmRes.rows[0].id;
        await db.exec(`INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('1234567890', 'Client A', ${firmId}, 'token')`);
    });

    afterAll(async () => {
        await db.close();
    });

    it.each(['new', 'classified', 'sent', 'rejected', 'exported_jpk', 'error', 'duplicate'])('accepts status=%s', async (status) => {
        await expect(
            db.query(
                `INSERT INTO invoices (client_nip, firm_id, ksef_number, direction, processing_status)
                 VALUES ('1234567890', $1, $2, 'sales', $3)`,
                [firmId, `KSEF-${status}`, status]
            )
        ).resolves.not.toThrow();
    });

    it('rejects a value outside the vocabulary', async () => {
        await expect(
            db.query(
                `INSERT INTO invoices (client_nip, firm_id, ksef_number, direction, processing_status)
                 VALUES ('1234567890', $1, 'KSEF-bogus', 'sales', 'bogus')`,
                [firmId]
            )
        ).rejects.toThrow();
    });

    it('stores a rejection reason', async () => {
        await db.query(
            `INSERT INTO invoices (client_nip, firm_id, ksef_number, direction, processing_status, ksef_rejection_reason)
             VALUES ('1234567890', $1, 'KSEF-reason', 'sales', 'rejected', 'Duplikat faktury')`,
            [firmId]
        );
        const res = await db.query<{ ksef_rejection_reason: string }>(
            `SELECT ksef_rejection_reason FROM invoices WHERE ksef_number = 'KSEF-reason'`
        );
        expect(res.rows[0].ksef_rejection_reason).toBe('Duplikat faktury');
    });
});

describe('jpk/generate POST marks included invoices exported_jpk, but never overwrites rejected/error', () => {
    it('updates sent/new/classified invoices but excludes a rejected one from the UPDATE', async () => {
        vi.resetModules();
        const queryMock = vi.fn(async (sql: string, _params?: unknown[]) => {
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '1234567890', client_name: 'Acme', tax_office_code: '1471', contact_email: 'acme@example.com' }] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('FROM invoices')) {
                return {
                    rows: [
                        { id: 1, invoice_number: 'FV/1', issue_date: '2026-01-05', seller_name: 'S', buyer_name: 'B', net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales', jpk_marker: 'NrKSeF', ksef_number: '1234567890-20260205-ABCDEF-123456-7A' },
                        { id: 2, invoice_number: 'FV/2', issue_date: '2026-01-06', seller_name: 'S', buyer_name: 'B', net_amount: 50, vat_amount: 11.5, gross_amount: 61.5, direction: 'sales', jpk_marker: 'NrKSeF', ksef_number: '1234567890-20260206-ABCDEF-123456-7B' },
                    ],
                };
            }
            return { rows: [] };
        });
        vi.doMock('@/lib/db', () => ({ query: queryMock }));
        vi.doMock('@/lib/auth', () => ({
            getSession: vi.fn(async () => ({ firmId: 1 })),
            requireRole: vi.fn(async () => null),
        }));
        vi.doMock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

        const { POST } = await import('@/app/api/jpk/generate/route');
        const res = await POST(new Request('http://localhost/api/jpk/generate', {
            method: 'POST',
            body: JSON.stringify({ clientNip: '1234567890', period: '2026-02' }),
        }));
        expect(res.status).toBe(200);

        const updateCall = queryMock.mock.calls.find(([sql]) => sql.includes('UPDATE invoices'));
        expect(updateCall).toBeTruthy();
        const [sql, params] = updateCall!;
        expect(sql).toContain(`processing_status = 'exported_jpk'`);
        expect(sql).toContain(`NOT IN ('rejected', 'error')`);
        expect(params).toEqual([[1, 2], 1]);
    });
});
