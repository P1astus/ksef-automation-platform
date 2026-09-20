import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { clientSyncMode, enqueueClientSync } from '../jobs/manual-sync';
import { invoiceRetrievalJob, type KsefPort } from '../jobs/invoice-retrieval';
import { tickOnce } from '../jobs/runner';
import type { Db } from '../jobs/queue';

// POST /api/clients/[id]/sync: embedded scheduler -> enqueue a client-scoped occurrence; else the n8n webhook; else 503.

describe('clientSyncMode', () => {
    const on = { SCHEDULER_ENABLED: 'true', JOBS_ENABLED: 'health-check,invoice-retrieval' };
    it('scheduler on and the job enabled: the worker does it', () => expect(clientSyncMode(on)).toBe('scheduler'));
    it('the scheduler wins over a configured webhook', () => expect(clientSyncMode({ ...on, N8N_SYNC_WEBHOOK_URL: 'http://n8n/x' })).toBe('scheduler'));
    it('scheduler on but invoice-retrieval NOT enabled (only shadow or absent): never queue for a job nobody runs', () => {
        expect(clientSyncMode({ SCHEDULER_ENABLED: 'true', JOBS_ENABLED: 'health-check' })).toBe('none');
        expect(clientSyncMode({ SCHEDULER_ENABLED: 'true', JOBS_ENABLED: 'health-check', N8N_SYNC_WEBHOOK_URL: 'http://n8n/x' })).toBe('webhook');
    });
    it('jobs enabled but the scheduler capability is off: not the worker', () => {
        expect(clientSyncMode({ JOBS_ENABLED: 'invoice-retrieval' })).toBe('none');
    });
    it('webhook only, or nothing', () => {
        expect(clientSyncMode({ N8N_SYNC_WEBHOOK_URL: 'http://n8n/x' })).toBe('webhook');
        expect(clientSyncMode({})).toBe('none');
    });
});

describe('a queued client sync reaches the job scoped to that client', () => {
    let pg: PGlite; let db: Db;
    const NOW = new Date('2026-09-21T10:00:00Z');
    beforeEach(async () => {
        pg = new PGlite(); await applyCurrentSchema(pg);
        db = { query: (t, p) => pg.query(t, p as any[]) as any };
    });

    it('stores the payload, coalesces a double-click within the minute, and allows a later one', async () => {
        const a = await enqueueClientSync(db, { clientId: 7, firmId: 3, now: NOW });
        const b = await enqueueClientSync(db, { clientId: 7, firmId: 3, now: new Date(NOW.getTime() + 20_000) });
        const c = await enqueueClientSync(db, { clientId: 7, firmId: 3, now: new Date(NOW.getTime() + 61_000) });
        const other = await enqueueClientSync(db, { clientId: 8, firmId: 3, now: NOW });
        expect([a.enqueued, b.enqueued, c.enqueued, other.enqueued]).toEqual([true, false, true, true]);
        const rows = (await pg.query<any>(`SELECT payload FROM job_occurrences WHERE job_name = 'invoice-retrieval' ORDER BY id`)).rows;
        expect(rows[0].payload).toEqual({ clientId: 7, firmId: 3 });
    });

    it('the worker claims it and only that client is synced (end to end through the real runner)', async () => {
        const f = (await pg.query<any>(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('a','a','a@x.invalid','x') RETURNING id`)).rows[0].id;
        const ids: number[] = [];
        for (const nip of ['1111111111', '3333333333']) {
            ids.push((await pg.query<any>(`INSERT INTO clients (firm_id, nip, client_name, auth_method, ksef_token_encrypted, sync_enabled) VALUES ($1, $2, 'c', 'token', 'x', true) RETURNING id`, [f, nip])).rows[0].id);
        }
        const authenticated: string[] = [];
        const ksef: KsefPort = {
            authenticate: vi.fn(async (nip: string) => { authenticated.push(nip); return 't'; }),
            query: vi.fn(async () => ({ invoices: [], hasMore: false, isTruncated: false, permanentStorageHwmDate: new Date(NOW.getTime() - 1000).toISOString() })),
            terminate: vi.fn(async () => {}),
        };
        await enqueueClientSync(db, { clientId: ids[1], firmId: f, now: NOW });
        const summary = await tickOnce({ db, jobs: [invoiceRetrievalJob({ ksef, decryptToken: s => s })], enabled: ['invoice-retrieval'], workerId: 'w1', now: () => NOW, log: () => {} });
        expect(summary.ran.some(r => r.job === 'invoice-retrieval')).toBe(true);
        // The same tick also runs the regular scheduled occurrence (every client); the manual one must have covered just one.
        const rows = (await pg.query<any>(`SELECT occurrence_key, result FROM job_occurrences WHERE job_name = 'invoice-retrieval' ORDER BY occurrence_key`)).rows;
        const manual = rows.find(r => r.occurrence_key.startsWith('manual:'));
        const scheduled = rows.find(r => !r.occurrence_key.startsWith('manual:'));
        expect(manual.result.detail.clients).toBe(1);
        expect(manual.result.detail.perClient.map((c: any) => c.nip)).toEqual(['3333333333']);
        expect(scheduled.result.detail.clients).toBe(2);
        expect(authenticated).toContain('3333333333');
    });
});
