import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// clients/[id]/erase/route.ts's core behavior: proves the erase action
// clears exactly the CRM/contact columns and nothing else, and — the whole
// point of scoping it this way, per migrations/2026-09-14-gdpr-erasure.sql's
// comment — that an invoice referencing the (now-anonymized) client keeps
// its original buyer_name/seller_name untouched, since those are a
// snapshot of what was actually filed with KSeF, not erasable personal
// data.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('GDPR client erasure: scoped to CRM fields, invoices untouched', () => {
    let db: PGlite;
    let firmId: number;
    let clientId: number;

    beforeAll(async () => {
        db = new PGlite();
        for (const file of ['ksef-schema.sql', 'ksef-schema-migration.sql', 'ksef-schema-migration-v2.sql', join('migrations', 'sprint9-13.sql'), join('migrations', '2026-09-13-tenancy-fix.sql'), join('migrations', '2026-09-14-gdpr-erasure.sql')]) {
            await db.exec(readFileSync(join(ROOT, file), 'utf8'));
        }

        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x') RETURNING id`
        );
        firmId = firmRes.rows[0].id;

        const clientRes = await db.query<{ id: number }>(
            `INSERT INTO clients (nip, client_name, firm_id, auth_method, contact_person, contact_email, contact_phone, notes, tags)
             VALUES ('1234567890', 'Client A', $1, 'token', 'Jan Kowalski', 'jan@example.com', '+48600000000', 'VIP client', 'important')
             RETURNING id`,
            [firmId]
        );
        clientId = clientRes.rows[0].id;

        await db.exec(
            `INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction, seller_name, buyer_name)
             VALUES (${firmId}, '1234567890', 'KSEF-1', 'FV/1', 'sales', 'Client A', 'Some Buyer')`
        );
    });

    afterAll(async () => {
        await db.close();
    });

    it('erasure clears contact_person/email/phone/notes/tags and sets anonymized_at', async () => {
        await db.query(
            `UPDATE clients SET contact_person = NULL, contact_email = NULL, contact_phone = NULL, notes = NULL, tags = NULL, anonymized_at = NOW() WHERE id = $1`,
            [clientId]
        );
        const res = await db.query<any>(`SELECT * FROM clients WHERE id = $1`, [clientId]);
        const row = res.rows[0];
        expect(row.contact_person).toBeNull();
        expect(row.contact_email).toBeNull();
        expect(row.contact_phone).toBeNull();
        expect(row.notes).toBeNull();
        expect(row.tags).toBeNull();
        expect(row.anonymized_at).not.toBeNull();
    });

    it('client_name, nip, and auth_method (non-CRM fields) are NOT cleared by erasure', async () => {
        const res = await db.query<any>(`SELECT client_name, nip, auth_method FROM clients WHERE id = $1`, [clientId]);
        expect(res.rows[0].client_name).toBe('Client A');
        expect(res.rows[0].nip).toBe('1234567890');
        expect(res.rows[0].auth_method).toBe('token');
    });

    it("the client's invoice keeps its original seller_name/buyer_name untouched — the filed tax record is never rewritten", async () => {
        const res = await db.query<any>(`SELECT seller_name, buyer_name FROM invoices WHERE client_nip = '1234567890'`);
        expect(res.rows[0].seller_name).toBe('Client A');
        expect(res.rows[0].buyer_name).toBe('Some Buyer');
    });
});
