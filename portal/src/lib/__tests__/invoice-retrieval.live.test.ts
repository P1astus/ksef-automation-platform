import { describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyCurrentSchema } from './helpers/baseline';
import { invoiceRetrievalJob } from '../jobs/invoice-retrieval';

// Opt-in only. Uses a disposable in-memory database, real sidecar encryption and real KSeF TEST metadata.
// KSEF_LIVE=1 KSEF_LIVE_TOKEN=<secret> KSEF_LIVE_NIP=<10 digits>
// XADES_SIDECAR_URL=http://localhost:8090 SIDECAR_API_KEY=<secret> npx vitest run <this file>
// Supply secrets through a private env file/session, never command history or committed fixtures.
describe.skipIf(process.env.KSEF_LIVE !== '1' || !process.env.KSEF_LIVE_TOKEN)('real KSeF TEST retrieval', () => {
    it('authenticates, retrieves both directions, and commits rows and server watermarks', async () => {
        if (process.env.KSEF_ENVIRONMENT === 'prod') throw new Error('LIVE retrieval test refuses production configuration');
        const nip = process.env.KSEF_LIVE_NIP ?? '';
        expect(nip).toMatch(/^\d{10}$/);
        vi.stubEnv('KSEF_ENVIRONMENT', 'test');
        vi.resetModules();
        const ksef = await import('../ksef-client');
        expect(ksef.BASE_URL).toBe('https://api-test.ksef.mf.gov.pl/v2');
        const pg = new PGlite();
        try {
            await applyCurrentSchema(pg);
            const firm = await pg.query<{ id: number }>(`INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash)
                VALUES ('Live TEST', 'live-test', 'test@example.invalid', 'unused') RETURNING id`);
            await pg.query(`INSERT INTO clients (firm_id, nip, client_name, auth_method, ksef_token_encrypted, sync_enabled)
                VALUES ($1, $2, 'Live TEST client', 'token', 'memory-only-placeholder', true)`, [firm.rows[0].id, nip]);
            const result = await invoiceRetrievalJob({
                ksef: { authenticate: ksef.initInteractiveSession, query: ksef.queryInvoices, terminate: ksef.terminateSession },
                decryptToken: () => process.env.KSEF_LIVE_TOKEN!,
            }).run({
                db: { query: (sql, params) => pg.query(sql, params) }, now: () => new Date(),
                shadow: false, signal: AbortSignal.timeout(180_000), log: () => {},
                alerts: { raise: async () => { throw new Error('LIVE test must not send alerts'); } },
            });
            // Report status, never credential material, response payloads or invoice contents.
            expect(result.failures?.length ?? 0, 'KSeF TEST retrieval failed; inspect the service securely').toBe(0);
            expect(result.processed).toBe(1);
            const state = (await pg.query<{ hwm_sales: Date; hwm_purchases: Date; last_sync_success: Date }>(
                'SELECT hwm_sales, hwm_purchases, last_sync_success FROM clients')).rows[0];
            expect(state.hwm_sales).toBeTruthy();
            expect(state.hwm_purchases).toBeTruthy();
            expect(state.last_sync_success).toBeTruthy();
        } finally {
            await pg.close();
            vi.unstubAllEnvs();
        }
    }, 240_000);
});
