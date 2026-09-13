import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// invoices.is_offline/offline_mode/offline_upload_deadline/offline_uploaded
// were confirmed fully dead once offline-invoice-linking.sql moved the whole
// offline-tracking flow onto offline_invoices (see that migration and
// offline-invoice-linking.test.ts). A repo-wide grep found no remaining
// reader or writer of these four columns anywhere. Proves the drop migration
// removes them cleanly and that the app's real insert/select shapes
// (invoices/create/route.ts, invoices/offline/route.ts) don't need them.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('drop-dead-offline-columns migration', () => {
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
            join('migrations', '2026-09-13-drop-dead-offline-columns.sql'),
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

    it('removes is_offline, offline_mode, offline_upload_deadline, offline_uploaded from invoices', async () => {
        const res = await db.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'invoices'
               AND column_name IN ('is_offline', 'offline_mode', 'offline_upload_deadline', 'offline_uploaded')`
        );
        expect(res.rows).toHaveLength(0);
    });

    it('drops the now-pointless idx_invoices_offline_deadline index', async () => {
        const res = await db.query(
            `SELECT indexname FROM pg_indexes WHERE tablename = 'invoices' AND indexname = 'idx_invoices_offline_deadline'`
        );
        expect(res.rows).toHaveLength(0);
    });

    it('the exact insert shape invoices/create/route.ts uses still succeeds without the dropped columns', async () => {
        await expect(
            db.query(
                `INSERT INTO invoices
                 (firm_id, client_nip, invoice_number, seller_name, buyer_name, buyer_nip,
                  net_amount, vat_amount, gross_amount, issue_date, due_date,
                  direction, processing_status, invoice_lines, raw_xml)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'sales','new',$12,$13)
                 RETURNING id`,
                [firmId, '1234567890', 'FV/DROP/001', 'Test Client', 'Buyer', '9876543210',
                 100, 23, 123, '2026-09-11', null, JSON.stringify([]), '<xml/>']
            )
        ).resolves.not.toThrow();
    });

    it('offline tracking still works entirely through offline_invoices after the drop', async () => {
        const invRes = await db.query<{ id: number }>(
            `INSERT INTO invoices
             (firm_id, client_nip, invoice_number, seller_name, buyer_name, buyer_nip,
              net_amount, vat_amount, gross_amount, issue_date, direction, processing_status, invoice_lines, raw_xml)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sales','new',$11,$12)
             RETURNING id`,
            [firmId, '1234567890', 'FV/DROP/002', 'Test Client', 'Buyer Two', '1112223334',
             500, 115, 615, '2026-09-11', JSON.stringify([]), '<xml/>']
        );
        const invoiceId = invRes.rows[0].id;

        await expect(
            db.query(
                `INSERT INTO offline_invoices
                 (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
                 VALUES ($1, $2, $3, $4, NOW(), (next_business_day($5::date) + INTERVAL '1 day' - INTERVAL '1 second'), $6)`,
                [firmId, '1234567890', 'FV/DROP/002', 'offline24', '2026-09-11', invoiceId]
            )
        ).resolves.not.toThrow();

        const res = await db.query(`SELECT invoice_id FROM offline_invoices WHERE invoice_id = $1`, [invoiceId]);
        expect(res.rows).toHaveLength(1);
    });
});
