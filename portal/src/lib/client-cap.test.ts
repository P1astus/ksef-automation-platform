import { describe, expect, it } from 'vitest';
import { ClientLimitReachedError, createClientWithinPlan, type ClientCapConnection } from './client-cap';

// Models the one property the production implementation relies on from
// Postgres: SELECT ... FOR UPDATE serializes transactions that lock the same
// firm row. This keeps the test fast while exercising the real helper's
// transaction/query sequence, including two concurrent creators racing for
// the last permitted client slot.
class FakeClientCapDatabase {
    clients = new Set<string>();
    private locked = false;
    private waiters: Array<() => void> = [];

    private async acquireLock() {
        if (this.locked) {
            await new Promise<void>(resolve => this.waiters.push(resolve));
        }
        this.locked = true;
    }

    private releaseLock() {
        const next = this.waiters.shift();
        if (next) next();
        else this.locked = false;
    }

    async connect(): Promise<ClientCapConnection> {
        let holdsLock = false;
        const unlock = () => {
            if (holdsLock) {
                holdsLock = false;
                this.releaseLock();
            }
        };

        return {
            query: async (text: string, values: unknown[] = []) => {
                if (text === 'BEGIN') return { rows: [] };
                if (text.includes('FROM firms') && text.includes('FOR UPDATE')) {
                    await this.acquireLock();
                    holdsLock = true;
                    return { rows: [{ max_clients: 1 }] };
                }
                if (text.startsWith('SELECT id FROM clients')) {
                    const nip = values[1] as string;
                    return { rows: this.clients.has(nip) ? [{ id: 1 }] : [] };
                }
                if (text.includes('COUNT(*)::int')) return { rows: [{ count: this.clients.size }] };
                if (text.includes('INSERT INTO clients')) {
                    const nip = values[1] as string;
                    if (this.clients.has(nip)) return { rows: [] };
                    this.clients.add(nip);
                    return { rows: [{ id: this.clients.size }] };
                }
                if (text === 'COMMIT' || text === 'ROLLBACK') {
                    unlock();
                    return { rows: [] };
                }
                throw new Error(`Unexpected query: ${text}`);
            },
            release: unlock,
        };
    }
}

describe('createClientWithinPlan', () => {
    it('serializes concurrent creation and refuses the request that would exceed the plan cap', async () => {
        const db = new FakeClientCapDatabase();
        const connect = () => db.connect();

        const results = await Promise.allSettled([
            createClientWithinPlan(1, { nip: '1111111111', clientName: 'First' }, connect),
            createClientWithinPlan(1, { nip: '2222222222', clientName: 'Second' }, connect),
        ]);

        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(r => r.status === 'rejected')[0]).toMatchObject({ reason: expect.any(ClientLimitReachedError) });
        expect(db.clients.size).toBe(1);
    });

    it('allows an already-existing NIP even if the firm is now at its cap', async () => {
        const db = new FakeClientCapDatabase();
        db.clients.add('1111111111');

        await expect(createClientWithinPlan(1, { nip: '1111111111', clientName: 'Existing' }, () => db.connect()))
            .resolves.toBe(false);
        expect(db.clients.size).toBe(1);
    });
});
