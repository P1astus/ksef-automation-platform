import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// Product decision (2026-09-13): jpk_preparations.status had two
// non-overlapping vocabularies in use - jpk/generate/route.ts wrote
// 'generated', while workflows/06-jpk-vat-preparation.json's own UPSERT node
// wrote 'ready'/'in_progress'/'correction_needed' derived from whether any
// invoice in the period is marked BFK (correction needed) or DI
// (undetermined, manual review). Resolved by unifying the portal route onto
// the workflow's vocabulary and rule, via the shared determineJpkStatus()
// helper exported from the route. This also un-widens the CHECK constraint:
// 'generated' is no longer accepted, since nothing should write it anymore.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('determineJpkStatus (route helper, mirrors the n8n workflow rule)', () => {
    it('flags correction_needed when any invoice is marked BFK (offline, uploaded late)', async () => {
        const { determineJpkStatus } = await import('@/app/api/jpk/generate/route');
        expect(determineJpkStatus([{ jpk_marker: 'NrKSeF' }, { jpk_marker: 'BFK' }])).toBe('correction_needed');
    });

    it('flags in_progress when any invoice is marked DI (undetermined, manual review) and none are BFK', async () => {
        const { determineJpkStatus } = await import('@/app/api/jpk/generate/route');
        expect(determineJpkStatus([{ jpk_marker: 'NrKSeF' }, { jpk_marker: 'DI' }])).toBe('in_progress');
    });

    it('is ready when every invoice has a determined, on-time marker', async () => {
        const { determineJpkStatus } = await import('@/app/api/jpk/generate/route');
        expect(determineJpkStatus([{ jpk_marker: 'NrKSeF' }, { jpk_marker: 'OFF' }])).toBe('ready');
        expect(determineJpkStatus([])).toBe('ready');
    });

    it('BFK takes priority over DI when both are present, matching the workflow\'s CASE order', async () => {
        const { determineJpkStatus } = await import('@/app/api/jpk/generate/route');
        expect(determineJpkStatus([{ jpk_marker: 'DI' }, { jpk_marker: 'BFK' }])).toBe('correction_needed');
    });
});

describe('jpk/generate POST writes the computed status, not a hardcoded value', () => {
    it('inserts status=correction_needed when the fetched invoices include a BFK marker', async () => {
        vi.resetModules();
        const queryMock = vi.fn(async (sql: string, _params?: unknown[]) => {
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '1234567890', client_name: 'Acme' }] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'Firm A' }] };
            if (sql.includes('FROM invoices')) {
                return {
                    rows: [
                        { id: 1, invoice_number: 'FV/1', issue_date: '2026-01-05', seller_name: 'S', buyer_name: 'B', net_amount: 100, vat_amount: 23, gross_amount: 123, direction: 'sales', jpk_marker: 'BFK' },
                    ],
                };
            }
            return { rows: [] };
        });
        vi.doMock('@/lib/db', () => ({ query: queryMock }));
        vi.doMock('@/lib/auth', () => ({
            getSession: vi.fn(async () => ({ firmId: 1 })),
            requireRole: vi.fn(async () => null), // this test isn't about role gating
        }));
        vi.doMock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

        const { POST } = await import('@/app/api/jpk/generate/route');
        const res = await POST(new Request('http://localhost/api/jpk/generate', {
            method: 'POST',
            body: JSON.stringify({ clientNip: '1234567890', period: '2026-01' }),
        }));
        expect(res.status).toBe(200);

        const insertCall = queryMock.mock.calls.find(([sql]) => sql.includes('INSERT INTO jpk_preparations'));
        expect(insertCall).toBeTruthy();
        const [, params] = insertCall!;
        expect(params?.[4]).toBe('correction_needed');
    });
});

describe('the CHECK constraint no longer accepts the retired \'generated\' value (real Postgres engine)', () => {
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
            join('migrations', '2026-09-13-jpk-preparations-fix.sql'),
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

    it('rejects status=generated', async () => {
        await expect(
            db.query(
                `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at) VALUES ($1, $2, $3, $4, 'generated', NOW())`,
                [firmId, '1234567890', '2026-05', '<xml/>']
            )
        ).rejects.toThrow();
    });

    it.each(['pending', 'in_progress', 'ready', 'exported', 'correction_needed'])('accepts status=%s', async (status) => {
        await expect(
            db.query(
                `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
                [firmId, '1234567890', `2026-${status.slice(0, 2)}`, '<xml/>', status]
            )
        ).resolves.not.toThrow();
    });
});
