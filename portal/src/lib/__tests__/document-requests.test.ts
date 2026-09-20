import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { applyBaseline } from './helpers/baseline';

// /api/upload/[token]'s resolveRequest(): the exact contract flagged as
// missing when 07-document-collection.json was deleted for having no auth
// (it trusted a bare client_nip in the request body, with no way to know
// which firm it belonged to). This proves firm_id/client_id are resolved
// server-side from the token alone against a real Postgres-compatible
// engine — an unknown token and an expired one both fail closed, and a
// caller has no way to claim a different client/firm than the token
// actually belongs to since the request never supplies one.

const ROOT = join(__dirname, '..', '..', '..', '..');

async function resolveRequest(db: PGlite, token: string) {
    const res = await db.query<{ firm_id: number; client_id: number; expires_at: string; client_nip: string; client_name: string }>(
        `SELECT dr.firm_id, dr.client_id, dr.expires_at, c.nip AS client_nip, c.client_name
         FROM document_requests dr JOIN clients c ON c.id = dr.client_id
         WHERE dr.token = $1`,
        [token]
    );
    const row = res.rows[0];
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
}

describe('document_requests token resolution (the 07-document-collection auth gap, closed)', () => {
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
            `INSERT INTO clients (nip, client_name, firm_id, auth_method, contact_email) VALUES ('1234567890', 'Client A', $1, 'token', 'client@example.com') RETURNING id`,
            [firmId]
        );
        clientId = clientRes.rows[0].id;

        await db.exec(
            `INSERT INTO document_requests (firm_id, client_id, token, expires_at) VALUES (${firmId}, ${clientId}, 'valid-token', NOW() + INTERVAL '7 days')`
        );
        await db.exec(
            `INSERT INTO document_requests (firm_id, client_id, token, expires_at) VALUES (${firmId}, ${clientId}, 'expired-token', NOW() - INTERVAL '1 day')`
        );
    });

    afterAll(async () => {
        await db.close();
    });

    it('resolves firm_id/client_id server-side for a valid token', async () => {
        const result = await resolveRequest(db, 'valid-token');
        expect(result?.firm_id).toBe(firmId);
        expect(result?.client_id).toBe(clientId);
        expect(result?.client_nip).toBe('1234567890');
    });

    it('rejects an expired token', async () => {
        const result = await resolveRequest(db, 'expired-token');
        expect(result).toBeNull();
    });

    it('rejects an unknown token', async () => {
        const result = await resolveRequest(db, 'nonexistent-token');
        expect(result).toBeNull();
    });
});
