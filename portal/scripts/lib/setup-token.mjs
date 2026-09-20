// Issue (or rotate) the one-time first-run setup token for the local edition. Only the SHA-256 is stored; the raw
// value is returned to the caller exactly once and never persisted. Must hash identically to lib/setup-token.ts.
import { createHash, randomBytes } from 'node:crypto';

export class SetupTokenError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'SetupTokenError';
        this.code = code;
    }
}

export function hashSetupToken(raw) {
    return createHash('sha256').update(String(raw).trim(), 'utf8').digest('hex');
}

/**
 * Replaces any UNCONSUMED token with a fresh one (that is the rotation path for a lost token). Refuses once a firm
 * exists: the token is a first-run credential and must not become a way to re-enter an installed system.
 * @param {{ query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }} db
 * @returns {Promise<string>} the raw token, to be shown once
 */
export async function issueSetupToken(db, generate = () => randomBytes(32).toString('base64url')) {
    const tables = await db.query(
        `SELECT to_regclass('public.setup_token') AS t, to_regclass('public.firms') AS f`,
    );
    if (!tables.rows[0].t || !tables.rows[0].f) {
        throw new SetupTokenError('the schema is not applied yet (setup_token/firms missing): run ksef_migrate first', 'SCHEMA_MISSING');
    }
    const firms = await db.query('SELECT COUNT(*)::int AS n FROM firms');
    if (firms.rows[0].n > 0) {
        throw new SetupTokenError('a firm already exists: the setup token is a first-run credential and cannot be reissued', 'FIRM_EXISTS');
    }
    const raw = generate();
    await db.query('DELETE FROM setup_token WHERE consumed_at IS NULL');
    await db.query('INSERT INTO setup_token (token_hash) VALUES ($1)', [hashSetupToken(raw)]);
    return raw;
}
