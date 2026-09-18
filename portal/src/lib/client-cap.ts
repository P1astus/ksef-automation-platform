import pool from '@/lib/db';

export class ClientLimitReachedError extends Error {
    constructor(readonly maxClients: number) {
        super(`Osiągnięto limit ${maxClients} klientów dla Twojego planu`);
        this.name = 'ClientLimitReachedError';
    }
}

export interface ClientSeed {
    nip: string;
    clientName: string;
    authMethod?: 'token' | 'certificate';
    permissionLevel?: 'read_write' | 'read_only';
    syncEnabled?: boolean;
}

export interface ClientCapConnection {
    query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
    release(): void;
}

/**
 * Creates a client only when the firm's current plan has capacity.
 *
 * `max_clients` is a per-firm aggregate limit, so a simple COUNT followed by
 * INSERT is racy: two requests can both observe the final free slot. Locking
 * the firm's one row serializes every cap-aware client creation path while
 * keeping unrelated firms fully concurrent. The composite conflict target is
 * still necessary because OCR, email, and review approval can legitimately
 * discover the same previously unseen NIP at once.
 *
 * Returns false when that NIP already belongs to the firm, true only when a
 * row was newly created.
 */
export async function createClientWithinPlan(
    firmId: number,
    seed: ClientSeed,
    connect: () => Promise<ClientCapConnection> = () => pool.connect()
): Promise<boolean> {
    const client = await connect();
    try {
        await client.query('BEGIN');

        const firmRes = await client.query(
            'SELECT max_clients FROM firms WHERE id = $1 FOR UPDATE',
            [firmId]
        );
        const firm = firmRes.rows[0];
        if (!firm) throw new Error(`Firma ${firmId} nie istnieje`);

        const existing = await client.query(
            'SELECT id FROM clients WHERE firm_id = $1 AND nip = $2',
            [firmId, seed.nip]
        );
        if (existing.rows.length > 0) {
            await client.query('COMMIT');
            return false;
        }

        const countRes = await client.query(
            'SELECT COUNT(*)::int AS count FROM clients WHERE firm_id = $1',
            [firmId]
        );
        if (countRes.rows[0].count >= firm.max_clients) {
            throw new ClientLimitReachedError(firm.max_clients);
        }

        const inserted = await client.query(
            `INSERT INTO clients (firm_id, nip, client_name, auth_method, permission_level, sync_enabled, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (firm_id, nip) DO NOTHING
             RETURNING id`,
            [
                firmId,
                seed.nip,
                seed.clientName,
                seed.authMethod ?? 'token',
                seed.permissionLevel ?? 'read_write',
                seed.syncEnabled ?? true,
            ]
        );

        await client.query('COMMIT');
        return inserted.rows.length > 0;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
