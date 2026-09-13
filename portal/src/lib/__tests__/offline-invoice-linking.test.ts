import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// Deep audit finding: 05-offline24-monitor.json (the every-2-hours
// deadline/alert workflow - CLAUDE.md calls this "the highest-stakes path in
// the system") exclusively queries offline_invoices, but nothing anywhere in
// the codebase ever wrote to it (nor to invoices.is_offline/
// offline_upload_deadline, which the portal's GET /api/invoices/offline used
// to read instead). Both tracking paths were permanently empty - the monitor
// workflow could never have alerted on a real deadline.
//
// Proves the fix end-to-end against a real Postgres-compatible engine: the
// exact INSERT invoices/create/route.ts now runs when offlineMode is set
// (including next_business_day() for the deadline, not ad-hoc JS date math -
// a Friday issue date must roll to Monday, not Saturday), the exact JOIN
// invoices/offline/route.ts's GET now runs, and the close-out UPDATE
// ksef/send/route.ts now runs when an offline-linked invoice is sent.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('offline_invoices write path (was entirely missing)', () => {
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
            join('migrations', '2026-09-13-offline-invoice-linking.sql'),
            'ksef-holidays-init.sql',
        ]) {
            await db.exec(readFileSync(join(ROOT, file), 'utf8'));
        }

        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x') RETURNING id`
        );
        firmId = firmRes.rows[0].id;

        await db.exec(`INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('1234567890', 'Test Client', ${firmId}, 'token')`);
    });

    afterAll(async () => {
        await db.close();
    });

    it('the migration adds offline_invoices.invoice_id', async () => {
        const res = await db.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = 'offline_invoices' AND column_name = 'invoice_id'`
        );
        expect(res.rows.length).toBe(1);
    });

    it('invoices/create/route.ts\'s offline branch: inserts a linked offline_invoices row with a next_business_day() deadline, not naive +1 day', async () => {
        // 2026-09-11 is a Friday - naive "+1 day" would land on Saturday.
        // next_business_day() must roll it to Monday 2026-09-14 instead.
        const invRes = await db.query<{ id: number }>(
            `INSERT INTO invoices
             (firm_id, client_nip, invoice_number, seller_name, buyer_name, buyer_nip,
              net_amount, vat_amount, gross_amount, issue_date, due_date,
              direction, processing_status, invoice_lines, raw_xml)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sales','new',$12,$13)
             RETURNING id`,
            [firmId, '1234567890', 'FV/OFF/001', 'Test Client', 'Buyer Sp. z o.o.', '9876543210',
             1000, 230, 1230, '2026-09-11', null, JSON.stringify([]), '<xml/>']
        );
        const invoiceId = invRes.rows[0].id;

        await db.query(
            `INSERT INTO offline_invoices
             (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
             VALUES ($1, $2, $3, $4, NOW(), (next_business_day($5::date) + INTERVAL '1 day' - INTERVAL '1 second'), $6)`,
            [firmId, '1234567890', 'FV/OFF/001', 'offline24', '2026-09-11', invoiceId]
        );

        const res = await db.query<{ upload_deadline: string | Date; invoice_id: number; uploaded_to_ksef: boolean }>(
            `SELECT upload_deadline, invoice_id, uploaded_to_ksef FROM offline_invoices WHERE invoice_id = $1`,
            [invoiceId]
        );
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].invoice_id).toBe(invoiceId);
        expect(res.rows[0].uploaded_to_ksef).toBe(false);
        const deadline = new Date(res.rows[0].upload_deadline);
        expect(deadline.toISOString().startsWith('2026-09-14')).toBe(true);
    });

    it('invoices/offline/route.ts\'s GET: joins offline_invoices -> invoices -> clients for display fields', async () => {
        const invRes = await db.query<{ id: number }>(
            `INSERT INTO invoices
             (firm_id, client_nip, invoice_number, seller_name, buyer_name, buyer_nip,
              net_amount, vat_amount, gross_amount, issue_date, direction, processing_status, invoice_lines, raw_xml)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sales','new',$11,$12)
             RETURNING id`,
            [firmId, '1234567890', 'FV/OFF/002', 'Test Client', 'Buyer Two', '1112223334',
             500, 115, 615, '2026-09-11', JSON.stringify([]), '<xml/>']
        );
        const invoiceId = invRes.rows[0].id;
        await db.query(
            `INSERT INTO offline_invoices (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
             VALUES ($1, $2, $3, 'offline24', NOW(), NOW() + INTERVAL '1 day', $4)`,
            [firmId, '1234567890', 'FV/OFF/002', invoiceId]
        );

        const res = await db.query<{ id: number; buyer_name: string; client_name: string; offline_mode: string }>(
            `SELECT i.id, i.invoice_number, i.ksef_number, i.issue_date,
                    i.seller_name, i.buyer_name, i.gross_amount, i.currency,
                    oi.offline_mode, oi.upload_deadline AS offline_upload_deadline,
                    c.client_name
             FROM offline_invoices oi
             JOIN invoices i ON i.id = oi.invoice_id
             JOIN clients c ON c.nip = oi.client_nip AND c.firm_id = oi.firm_id
             WHERE oi.firm_id = $1
               AND oi.uploaded_to_ksef = false
             ORDER BY oi.upload_deadline ASC NULLS LAST`,
            [firmId]
        );

        const row = res.rows.find(r => r.id === invoiceId);
        expect(row).toBeTruthy();
        expect(row!.buyer_name).toBe('Buyer Two');
        expect(row!.client_name).toBe('Test Client');
        expect(row!.offline_mode).toBe('offline24');
    });

    it('ksef/send/route.ts\'s close-out: marks the linked offline_invoices row uploaded once sent', async () => {
        const invRes = await db.query<{ id: number }>(
            `INSERT INTO invoices
             (firm_id, client_nip, invoice_number, seller_name, buyer_name, buyer_nip,
              net_amount, vat_amount, gross_amount, issue_date, direction, processing_status, invoice_lines, raw_xml)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sales','new',$11,$12)
             RETURNING id`,
            [firmId, '1234567890', 'FV/OFF/003', 'Test Client', 'Buyer Three', '5556667778',
             200, 46, 246, '2026-09-11', JSON.stringify([]), '<xml/>']
        );
        const invoiceId = invRes.rows[0].id;
        await db.query(
            `INSERT INTO offline_invoices (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
             VALUES ($1, $2, $3, 'offline24', NOW(), NOW() + INTERVAL '1 day', $4)`,
            [firmId, '1234567890', 'FV/OFF/003', invoiceId]
        );

        await db.query(
            `UPDATE offline_invoices SET uploaded_to_ksef = true, ksef_number = $1
             WHERE invoice_id = $2 AND uploaded_to_ksef = false`,
            ['1234567890-20260911-ABC123', invoiceId]
        );

        const res = await db.query<{ uploaded_to_ksef: boolean; ksef_number: string }>(
            `SELECT uploaded_to_ksef, ksef_number FROM offline_invoices WHERE invoice_id = $1`,
            [invoiceId]
        );
        expect(res.rows[0].uploaded_to_ksef).toBe(true);
        expect(res.rows[0].ksef_number).toBe('1234567890-20260911-ABC123');

        // A non-offline invoice (no offline_invoices row at all) must be a no-op, not an error.
        await expect(
            db.query(
                `UPDATE offline_invoices SET uploaded_to_ksef = true, ksef_number = $1
                 WHERE invoice_id = $2 AND uploaded_to_ksef = false`,
                ['irrelevant', 999999]
            )
        ).resolves.not.toThrow();
    });
});
