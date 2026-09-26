import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyCurrentSchema } from './helpers/baseline';

// The stress fixtures reset their own synthetic data before inserting it.
// That reset must be confined to the dedicated Stress Test Firm: run against a
// database that also holds a real firm, it previously deleted every firm's
// clients, invoices, offline invoices, JPK preparations and audit rows.

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

async function runFixtures(db: PGlite) {
    const [firmInsert, rest] = read('stress-test-clients.sql').split('\\gset');
    const firm = await db.query<{ stress_firm_id: number }>(firmInsert.trim());
    await db.exec(rest.replace(/:stress_firm_id\b/g, String(firm.rows[0].stress_firm_id)));
    await db.exec(read('stress-test-invoices.sql'));
    await db.exec(read('stress-test-offline.sql'));
}

describe('stress fixtures only touch the Stress Test Firm', () => {
    it("leaves another firm's data intact, including on a second run", async () => {
        const db = new PGlite();
        await applyCurrentSchema(db);
        const other = (await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Real Firm', 'real-firm', 'owner@real.example', 'x') RETURNING id`
        )).rows[0].id;
        await db.query(`INSERT INTO clients (firm_id, client_name, nip, auth_method) VALUES ($1, 'Real Client', '5260250274', 'token')`, [other]);
        // Same NIP as a stress certificate client: a firm's client can share a NIP with another firm's.
        await db.query(`INSERT INTO clients (firm_id, client_name, nip, auth_method) VALUES ($1, 'Shared NIP', '7773602609', 'certificate')`, [other]);
        const invoice = (await db.query<{ id: number }>(
            `INSERT INTO invoices (firm_id, client_nip, invoice_number, ksef_number, direction, issue_date, gross_amount)
             VALUES ($1, '5260250274', 'FV/REAL/1', '5260250274-20260901-0123456789AB-CD', 'sales', '2026-09-01', 123) RETURNING id`, [other]
        )).rows[0].id;
        await db.query(
            `INSERT INTO offline_invoices (firm_id, client_nip, invoice_number, offline_mode, issue_timestamp, upload_deadline, invoice_id)
             VALUES ($1, '5260250274', 'FV/REAL/1', 'offline24', NOW(), NOW() + INTERVAL '1 day', $2)`, [other, invoice]
        );
        await db.query(`INSERT INTO jpk_preparations (firm_id, client_nip, period, status) VALUES ($1, '5260250274', '2026-09', 'ready')`, [other]);
        await db.query(`INSERT INTO audit_log (firm_id, client_nip, action, success) VALUES ($1, '5260250274', 'real_action', true)`, [other]);

        await runFixtures(db);
        await runFixtures(db);

        const count = async (table: string) => (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE firm_id = $1`, [other])).rows[0].n;
        expect(await count('clients')).toBe(2);
        expect(await count('invoices')).toBe(1);
        expect(await count('offline_invoices')).toBe(1);
        expect(await count('jpk_preparations')).toBe(1);
        expect(await count('audit_log')).toBe(1);
        const stress = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM clients c JOIN firms f ON f.id = c.firm_id WHERE f.slug = 'stress-test-firm'`);
        expect(stress.rows[0].n).toBe(30);
    }, 120_000);
});
