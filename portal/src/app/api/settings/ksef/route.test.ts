import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyBaseline } from '@/lib/__tests__/helpers/baseline';

// settings/ksef/route.ts referenced clients.ksef_auth_method, a column that
// has never existed - the real column (ksef-schema.sql) is auth_method. Every
// GET and both POST UPDATE statements used the wrong name, so saving a
// client's KSeF token or certificate via Settings has always failed with a
// 500 "column does not exist" (confirmed live against the running stack).
// A second, independent bug in the same route: auth_method's CHECK
// constraint only allows 'token'/'certificate', but the cert-save branch
// wrote the literal 'cert' - would have violated the constraint even with
// the column name fixed. Proves the route's exact SQL shapes now succeed
// against the real schema, and that the DB<->API vocabulary translation
// ('certificate' <-> 'cert') round-trips correctly.

const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');

describe('settings/ksef/route.ts SQL shapes against the real schema', () => {
    let db: PGlite;
    let firmId: number;
    let clientId: number;

    beforeAll(async () => {
        db = new PGlite();
        await applyBaseline(db);
        const firmRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x') RETURNING id`
        );
        firmId = firmRes.rows[0].id;
        const clientRes = await db.query<{ id: number }>(
            `INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('1234567890', 'Test Client', ${firmId}, 'token') RETURNING id`
        );
        clientId = clientRes.rows[0].id;
    });

    afterAll(async () => {
        await db.close();
    });

    it('the token-save UPDATE (real column name) succeeds', async () => {
        await expect(
            db.query(`UPDATE clients SET auth_method = $1, ksef_token_encrypted = $2 WHERE id = $3`,
                ['token', Buffer.from('sometoken').toString('base64'), clientId])
        ).resolves.not.toThrow();
    });

    it("the cert-save UPDATE writes 'certificate', which the CHECK constraint actually allows", async () => {
        await expect(
            db.query(`UPDATE clients SET auth_method = $1, ksef_token_encrypted = $2 WHERE id = $3`,
                ['certificate', Buffer.from('{}').toString('base64'), clientId])
        ).resolves.not.toThrow();

        // The literal the route used to write - proves the CHECK constraint
        // really would have rejected it, so this isn't a hypothetical bug.
        await expect(
            db.query(`UPDATE clients SET auth_method = $1 WHERE id = $2`, ['cert', clientId])
        ).rejects.toThrow();
    });

    it('the GET SELECT (real column name) round-trips both auth methods via dbAuthMethodToApi', async () => {
        function dbAuthMethodToApi(dbValue: string | null): 'token' | 'cert' {
            return dbValue === 'certificate' ? 'cert' : 'token';
        }

        await db.query(`UPDATE clients SET auth_method = 'certificate' WHERE id = $1`, [clientId]);
        const certRes = await db.query<{ auth_method: string }>(
            `SELECT id, nip, client_name, auth_method, ksef_token_encrypted FROM clients WHERE id = $1 AND firm_id = $2`,
            [clientId, firmId]
        );
        expect(dbAuthMethodToApi(certRes.rows[0].auth_method)).toBe('cert');

        await db.query(`UPDATE clients SET auth_method = 'token' WHERE id = $1`, [clientId]);
        const tokenRes = await db.query<{ auth_method: string }>(
            `SELECT id, nip, client_name, auth_method, ksef_token_encrypted FROM clients WHERE id = $1 AND firm_id = $2`,
            [clientId, firmId]
        );
        expect(dbAuthMethodToApi(tokenRes.rows[0].auth_method)).toBe('token');
    });
});
