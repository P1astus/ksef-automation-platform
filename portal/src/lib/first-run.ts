import { hashSetupToken } from './setup-token';

// Local-edition first run: the very first firm may only be created by someone holding the one-time setup token.
// COUNT(*) = 0 alone would let any machine on the LAN claim a fresh install before its administrator does.

export class FirstRunClosedError extends Error {
    constructor() {
        super('Instalacja została już skonfigurowana');
        this.name = 'FirstRunClosedError';
    }
}

export class InvalidSetupTokenError extends Error {
    constructor() {
        super('Nieprawidłowy lub zużyty token instalacyjny');
        this.name = 'InvalidSetupTokenError';
    }
}

export interface FirstRunConnection {
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
    release(): void;
}

export function generateFirmSlug(firmName: string): string {
    const map: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
    const base = firmName
        .toLowerCase()
        .replace(/[ąćęłńóśźż]/g, (c) => map[c] || c)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `${base}-${suffix}`;
}

export interface FirstFirm {
    firmName: string;
    firmNip: string | null;
    adminEmail: string;
    passwordHash: string;
    /** Local install: an active Pro firm with no trial clock. Tier decides features; access policy decides activity. */
    subscriptionTier: string;
    maxClients: number;
}

// Constant 64-bit key (never hashtext, which is 32-bit and collides).
const FIRST_RUN_LOCK = '7263540125002';

/**
 * Inside an open transaction: insert the firm, retrying on a slug collision.
 *
 * Each attempt runs under a SAVEPOINT. Without it, the first raised 23505 aborts the whole transaction and every
 * later statement - including the retry - fails with "current transaction is aborted", so the retry loop that
 * works outside a transaction silently stops working inside one.
 */
export async function insertFirmInTransaction(
    tx: Pick<FirstRunConnection, 'query'>,
    firm: FirstFirm,
    slugFor: (name: string) => string = generateFirmSlug,
    attempts = 3
): Promise<number> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        await tx.query('SAVEPOINT firm_insert');
        try {
            const res = await tx.query(
                `INSERT INTO firms
                    (firm_name, firm_nip, slug, admin_email, admin_password_hash,
                     subscription_tier, subscription_status, max_clients, trial_expires_at, is_active)
                 VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, NULL, true)
                 RETURNING id`,
                [firm.firmName, firm.firmNip, slugFor(firm.firmName), firm.adminEmail, firm.passwordHash, firm.subscriptionTier, firm.maxClients]
            );
            await tx.query('RELEASE SAVEPOINT firm_insert');
            return res.rows[0].id;
        } catch (err: any) {
            await tx.query('ROLLBACK TO SAVEPOINT firm_insert');
            if (err?.code === '23505' && attempt < attempts - 1) continue;
            throw err;
        }
    }
    throw new Error('Failed to create the first firm after retries');
}

/**
 * Create the first firm, but only for the holder of the setup token, and only while no firm exists.
 * One transaction: advisory lock -> "no firm yet" re-check -> consume the token -> insert the firm. The token's
 * UPDATE ... RETURNING is the claim: no row, no registration. Any failure rolls all of it back, so a failed
 * attempt never burns the token.
 */
export async function registerFirstFirm(
    connect: () => Promise<FirstRunConnection>,
    setupToken: string,
    firm: FirstFirm,
    slugFor?: (name: string) => string
): Promise<number> {
    const client = await connect();
    try {
        await client.query('BEGIN');
        try {
            await client.query('SELECT pg_advisory_xact_lock($1)', [FIRST_RUN_LOCK]);

            const count = await client.query('SELECT COUNT(*)::int AS n FROM firms');
            if (count.rows[0].n > 0) throw new FirstRunClosedError();

            const claim = await client.query(
                'UPDATE setup_token SET consumed_at = NOW() WHERE token_hash = $1 AND consumed_at IS NULL RETURNING id',
                [hashSetupToken(setupToken)]
            );
            if (claim.rows.length === 0) throw new InvalidSetupTokenError();

            const firmId = await insertFirmInTransaction(client, firm, slugFor);
            await client.query('COMMIT');
            return firmId;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
    } finally {
        client.release();
    }
}
