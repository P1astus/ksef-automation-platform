import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyBaseline, DB_DIR } from './helpers/baseline';

// db/migrations/2026-09-21-invoices-unique-per-client.sql: adds UNIQUE (firm_id, client_nip, ksef_number), and STOPS AND
// REPORTS when production already holds duplicates - it never picks which copy of a tax invoice to delete.

const MIGRATION = readFileSync(join(DB_DIR, 'migrations', '2026-09-21-invoices-unique-per-client.sql'), 'utf8');
let pg: PGlite;

async function seed() {
    await pg.query(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('a', 'a', 'a@x.invalid', 'x'), ('b', 'b', 'b@x.invalid', 'x')`);
    await pg.query(`INSERT INTO clients (firm_id, nip, client_name, auth_method) VALUES (1, '1111111111', 'c', 'token'), (1, '2222222222', 'c2', 'token'), (2, '1111111111', 'c', 'token')`);
}
const insert = (firm: number, nip: string, ksef: string | null, no = 'FV/1') =>
    pg.query(`INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction) VALUES ($1, $2, $3, $4, 'sales')`, [firm, nip, ksef, no]);

beforeEach(async () => {
    pg = new PGlite();
    await applyBaseline(pg);
    await seed();
});

describe('2026-09-21-invoices-unique-per-client', () => {
    it('applies to clean data and then enforces the per-client key (ON CONFLICT target works)', async () => {
        await insert(1, '1111111111', 'K-1');
        await pg.exec(MIGRATION);
        const r = await pg.query<any>(`INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction) VALUES (1, '1111111111', 'K-1', 'x', 'sales') ON CONFLICT (firm_id, client_nip, ksef_number) DO NOTHING RETURNING id`);
        expect(r.rows).toEqual([]);
    });

    it('is expand-only: the old global unique is left in place for still-running older code', async () => {
        await pg.exec(MIGRATION);
        const c = await pg.query<any>(`SELECT conname FROM pg_constraint WHERE conrelid = 'invoices'::regclass AND contype = 'u' ORDER BY conname`);
        expect(c.rows.map(x => x.conname)).toEqual(['invoices_firm_client_ksef_key', 'invoices_ksef_number_key']);
    });

    it('STOPS and reports existing duplicates - nothing is deduplicated or deleted', async () => {
        await pg.query('ALTER TABLE invoices DROP CONSTRAINT invoices_ksef_number_key'); // a database that lost the global key
        await insert(1, '1111111111', 'K-DUP', 'FV/a');
        await insert(1, '1111111111', 'K-DUP', 'FV/b');
        await expect(pg.exec(MIGRATION)).rejects.toThrow(/duplicate \(firm_id, client_nip, ksef_number\)[\s\S]*K-DUP x2/);
        expect((await pg.query<any>('SELECT count(*)::int n FROM invoices')).rows[0].n).toBe(2);
    });

    it('does not mistake legitimate rows for duplicates: same number for two clients, two firms, and unsent (NULL) invoices', async () => {
        await pg.query('ALTER TABLE invoices DROP CONSTRAINT invoices_ksef_number_key');
        await insert(1, '1111111111', 'K-1'); await insert(1, '2222222222', 'K-1'); await insert(2, '1111111111', 'K-1');
        await insert(1, '1111111111', null, 'FV/n1'); await insert(1, '1111111111', null, 'FV/n2');
        await expect(pg.exec(MIGRATION)).resolves.not.toThrow();
    });

    it('lists the expand migration followed by the promoted global-unique contract step', () => {
        const manifest = JSON.parse(readFileSync(join(DB_DIR, 'migrations', 'manifest.json'), 'utf8')).migrations.map((m: any) => m.file);
        expect(manifest).toContain('2026-09-21-invoices-unique-per-client.sql');
        expect(manifest).toContain('2026-09-23-drop-global-ksef-number-unique.sql');
        expect(manifest.indexOf('2026-09-21-invoices-unique-per-client.sql')).toBeGreaterThan(manifest.indexOf('2026-09-20-job-harness.sql'));
        expect(manifest.indexOf('2026-09-23-drop-global-ksef-number-unique.sql')).toBeGreaterThan(manifest.indexOf('2026-09-21-invoices-unique-per-client.sql'));
    });
});
