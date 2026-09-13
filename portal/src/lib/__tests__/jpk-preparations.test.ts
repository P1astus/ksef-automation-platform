import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// D3: jpk_preparations was defined twice (ksef-schema.sql: no firm_id,
// export_data JSONB, UNIQUE(client_nip, period); sprint9-13.sql's
// CREATE TABLE IF NOT EXISTS silently no-op'd against the live table).
// jpk/generate/route.ts's insert - firm_id, and a raw XML string bound to
// export_data - could never have succeeded against the live shape: no
// firm_id column, and JSONB rejects a non-JSON string outright. Proves the
// migration actually fixes both, against a real Postgres-compatible engine.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('D3 jpk_preparations fix (real Postgres engine, not mocked)', () => {
    let db: PGlite;
    let firmA: number, firmB: number;

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

        const firmARes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x') RETURNING id`
        );
        firmA = firmARes.rows[0].id;
        const firmBRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm B', 'firm-b', 'b@example.com', 'x') RETURNING id`
        );
        firmB = firmBRes.rows[0].id;

        await db.exec(`INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('1234567890', 'Shared-NIP Client A', ${firmA}, 'token')`);
        await db.exec(`INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('1234567890', 'Shared-NIP Client B', ${firmB}, 'token')`);
    });

    afterAll(async () => {
        await db.close();
    });

    it('accepts a raw XML string in export_data (was JSONB, now TEXT)', async () => {
        const rawXml = '<?xml version="1.0"?><JPK><Naglowek/></JPK>';
        await expect(
            db.query(
                `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at)
                 VALUES ($1, $2, $3, $4, 'ready', NOW())`,
                [firmA, '1234567890', '2026-01', rawXml]
            )
        ).resolves.not.toThrow();

        const res = await db.query<{ export_data: string }>(
            `SELECT export_data FROM jpk_preparations WHERE firm_id = $1 AND client_nip = $2 AND period = $3`,
            [firmA, '1234567890', '2026-01']
        );
        expect(res.rows[0].export_data).toBe(rawXml);
    });

    it('the exact insert shape jpk/generate/route.ts uses (firm_id + ON CONFLICT upsert) succeeds', async () => {
        const upsert = () => db.query(
            `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at)
             VALUES ($1, $2, $3, $4, 'ready', NOW())
             ON CONFLICT (firm_id, client_nip, period) DO UPDATE
             SET export_data = EXCLUDED.export_data, status = 'ready', created_at = NOW()`,
            [firmA, '1234567890', '2026-02', '<xml>v1</xml>']
        );
        await expect(upsert()).resolves.not.toThrow();
        // second call exercises the ON CONFLICT ... DO UPDATE path
        await expect(upsert()).resolves.not.toThrow();
    });

    it('two firms sharing a NIP can each have their own jpk_preparations row for the same period', async () => {
        await db.query(
            `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at) VALUES ($1, $2, $3, $4, 'ready', NOW())`,
            [firmA, '1234567890', '2026-03', '<xml>firm-a</xml>']
        );
        // Would have collided under the old UNIQUE(client_nip, period) - now scoped by firm_id too.
        await expect(
            db.query(
                `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at) VALUES ($1, $2, $3, $4, 'ready', NOW())`,
                [firmB, '1234567890', '2026-03', '<xml>firm-b</xml>']
            )
        ).resolves.not.toThrow();
    });

    it('still rejects a true duplicate within the same firm+client+period', async () => {
        await db.query(
            `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at) VALUES ($1, $2, $3, $4, 'ready', NOW())`,
            [firmA, '1234567890', '2026-04', '<xml>first</xml>']
        );
        await expect(
            db.query(
                `INSERT INTO jpk_preparations (firm_id, client_nip, period, export_data, status, created_at) VALUES ($1, $2, $3, $4, 'ready', NOW())`,
                [firmA, '1234567890', '2026-04', '<xml>second</xml>']
            )
        ).rejects.toThrow();
    });
});
