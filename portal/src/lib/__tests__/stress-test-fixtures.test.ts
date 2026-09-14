import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// Round 4: "stress-test fixtures exist but were never fully exercised"
// (CLAUDE.md). Actually running all three for the first time found they
// predate the tenancy migration and never carried a firm_id:
// stress-test-clients.sql "succeeded" only because clients.firm_id happens
// to be nullable (silently producing 30 orphaned clients belonging to no
// firm); stress-test-invoices.sql and stress-test-offline.sql both failed
// outright with "null value in column firm_id violates not-null constraint"
// (both columns are NOT NULL). Fixed by creating one dedicated stress-test
// firm and threading its id through all three files via psql's \gset.
//
// A second, independent, previously-undiscovered bug turned up in the
// process: stress-test-invoices.sql's "CERTIFICATE AUTH clients" block had
// always inserted zero rows, even before the firm_id gap - all 4 certificate
// clients have monthly_invoice_volume >= 80 so they're already classified
// 'medium' and get 400 invoices each from the MEDIUM-VOLUME block first,
// using the exact same ksef_number pattern for an overlapping `s` range;
// every row the certificate block tried to insert collided with one that
// already existed and ON CONFLICT (ksef_number) DO NOTHING ate all of them
// silently. Fixed by giving that block its own ksef_number/invoice_number
// prefix (STC/FVC).
//
// This test runs the actual .sql files (not a reimplementation) against a
// real Postgres-compatible engine, the same way tenancy.test.ts and
// offline-invoice-linking.test.ts already do - pglite has no psql, so the
// \gset step is replicated manually (execute the firm INSERT, capture the
// id, substitute it for :stress_firm_id in the rest of the file) rather than
// skipped.

const ROOT = join(__dirname, '..', '..', '..', '..');

function readSql(relPath: string): string {
    return readFileSync(join(ROOT, relPath), 'utf8');
}

describe('stress-test fixtures actually run against the current schema', () => {
    let db: PGlite;
    let stressFirmId: number;

    beforeAll(async () => {
        db = new PGlite();

        for (const file of [
            'ksef-schema.sql',
            'ksef-schema-migration.sql',
            'ksef-schema-migration-v2.sql',
            join('migrations', 'sprint9-13.sql'),
            join('migrations', '2026-09-13-tenancy-fix.sql'),
            join('migrations', '2026-09-13-jpk-preparations-fix.sql'),
            join('migrations', '2026-09-13-offline-invoice-linking.sql'),
            join('migrations', '2026-09-13-drop-dead-offline-columns.sql'),
            join('migrations', '2026-09-14-bound-next-business-day.sql'),
        ]) {
            await db.exec(readSql(file));
        }

        // --- stress-test-clients.sql: replicate what psql's \gset does ---
        const clientsSql = readSql('stress-test-clients.sql');
        const [firmInsertRaw, restRaw] = clientsSql.split('\\gset');
        expect(restRaw, 'stress-test-clients.sql should still use \\gset exactly once').toBeTruthy();

        const firmResult = await db.query<{ stress_firm_id: number }>(firmInsertRaw.trim());
        stressFirmId = firmResult.rows[0].stress_firm_id;

        const restSubstituted = restRaw.replace(/:stress_firm_id\b/g, String(stressFirmId));
        await db.exec(restSubstituted);

        // --- stress-test-invoices.sql and stress-test-offline.sql: plain SQL ---
        await db.exec(readSql('stress-test-invoices.sql'));
        await db.exec(readSql('stress-test-offline.sql'));
    });

    afterAll(async () => {
        await db.close();
    });

    it('creates one stress-test firm and 30 clients all belonging to it', async () => {
        const firm = await db.query<{ slug: string }>('SELECT slug FROM firms WHERE id = $1', [stressFirmId]);
        expect(firm.rows[0].slug).toBe('stress-test-firm');

        const clients = await db.query<{ cnt: string; orphaned: string }>(
            'SELECT COUNT(*) AS cnt, COUNT(*) FILTER (WHERE firm_id IS NULL) AS orphaned FROM clients WHERE nip != $1',
            ['1111111111']
        );
        expect(Number(clients.rows[0].cnt)).toBe(30);
        expect(Number(clients.rows[0].orphaned)).toBe(0);
    });

    it('inserts all 15,400 invoices with no NULL firm_id anywhere (the bug that made this fail outright)', async () => {
        const total = await db.query<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM invoices');
        expect(Number(total.rows[0].cnt)).toBe(15400);

        const orphaned = await db.query<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM invoices WHERE firm_id IS NULL');
        expect(Number(orphaned.rows[0].cnt)).toBe(0);
    });

    it('the CERTIFICATE AUTH block actually inserts its 1,200 rows instead of colliding with the MEDIUM block', async () => {
        const cert = await db.query<{ cnt: string }>("SELECT COUNT(*) AS cnt FROM invoices WHERE ksef_number LIKE 'STC%'");
        expect(Number(cert.rows[0].cnt)).toBe(1200);

        const perCertClient = await db.query<{ client_nip: string; cnt: string }>(
            `SELECT client_nip, COUNT(*) AS cnt FROM invoices
             WHERE client_nip IN ('7773602609','7474687236','5309805002','8882081216')
             GROUP BY client_nip ORDER BY client_nip`
        );
        // 400 from the MEDIUM-VOLUME block (they qualify by volume) + 300 from
        // their own CERTIFICATE AUTH block (150 sales + 150 purchase) = 700 each.
        for (const row of perCertClient.rows) {
            expect(Number(row.cnt)).toBe(700);
        }
    });

    it('inserts 69 offline invoices across all 5 urgency tiers with no NULL firm_id', async () => {
        const total = await db.query<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM offline_invoices');
        expect(Number(total.rows[0].cnt)).toBe(69);

        const orphaned = await db.query<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM offline_invoices WHERE firm_id IS NULL');
        expect(Number(orphaned.rows[0].cnt)).toBe(0);
    });

    it('the real 05-offline24-monitor.json "Get Pending Invoices" query returns exactly the pending rows the fixture predicts', async () => {
        // The literal query from that workflow node - not a paraphrase.
        const result = await db.query(
            `SELECT id, firm_id, invoice_number, client_nip, offline_mode, issue_timestamp, upload_deadline, uploaded_to_ksef, ksef_number, alert_sent_overdue, alert_sent_1h, alert_sent_4h FROM offline_invoices WHERE uploaded_to_ksef = false ORDER BY upload_deadline ASC`
        );
        const expected = await db.query<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM offline_invoices WHERE uploaded_to_ksef = false');
        expect(result.rows.length).toBe(Number(expected.rows[0].cnt));
        expect(result.rows.length).toBe(59);
    });
});
