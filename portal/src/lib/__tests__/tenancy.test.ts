import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';

// D1 + D2: proves the tenancy fix actually isolates firms, against a real
// Postgres-compatible engine (pglite) running the actual schema files and
// the actual migrations/2026-09-13-tenancy-fix.sql - not a mock. This is
// also the only execution test the migration itself gets in this pass,
// since no live Postgres was available to run it against directly.
//
// Two firms are seeded with a client sharing the SAME NIP (the exact
// scenario D1 makes possible and D2's fix is about) and one invoice each.
// Each case runs the ACTUAL fixed query pattern from the route file named
// in its title, then the OLD unfixed pattern it replaced, proving the old
// shape leaks and the new one doesn't.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('D1+D2 tenancy fix (real Postgres engine, not mocked)', () => {
    let db: PGlite;
    let firmA: number, firmB: number;
    let invoiceA: number, invoiceB: number;
    const sharedNip = '1234567890';

    beforeAll(async () => {
        db = new PGlite();

        const schema = readFileSync(join(ROOT, 'ksef-schema.sql'), 'utf8');
        const migration1 = readFileSync(join(ROOT, 'ksef-schema-migration.sql'), 'utf8');
        const migration2 = readFileSync(join(ROOT, 'ksef-schema-migration-v2.sql'), 'utf8');
        const sprint = readFileSync(join(ROOT, 'migrations', 'sprint9-13.sql'), 'utf8');
        const tenancyFix = readFileSync(join(ROOT, 'migrations', '2026-09-13-tenancy-fix.sql'), 'utf8');

        await db.exec(schema);
        await db.exec(migration1);
        await db.exec(migration2);
        await db.exec(sprint);
        // This is the actual migration file being fixed for D1/D2 - executing
        // it here is the only place it gets run in this whole pass.
        await db.exec(tenancyFix);

        const firmARes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm A', 'firm-a', 'a@example.com', 'x') RETURNING id`
        );
        firmA = firmARes.rows[0].id;

        const firmBRes = await db.query<{ id: number }>(
            `INSERT INTO firms (firm_name, slug, admin_email, admin_password_hash) VALUES ('Firm B', 'firm-b', 'b@example.com', 'x') RETURNING id`
        );
        firmB = firmBRes.rows[0].id;

        // Both firms have a client with the SAME NIP - the scenario D1 makes
        // legal and D2's fix must not let leak.
        await db.exec(
            `INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('${sharedNip}', 'Client at Firm A', ${firmA}, 'token')`
        );
        await db.exec(
            `INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('${sharedNip}', 'Client at Firm B', ${firmB}, 'token')`
        );

        const invARes = await db.query<{ id: number }>(
            `INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction) VALUES (${firmA}, '${sharedNip}', 'KSEF-A-1', 'INV-A-1', 'sales') RETURNING id`
        );
        invoiceA = invARes.rows[0].id;

        const invBRes = await db.query<{ id: number }>(
            `INSERT INTO invoices (firm_id, client_nip, ksef_number, invoice_number, direction) VALUES (${firmB}, '${sharedNip}', 'KSEF-B-1', 'INV-B-1', 'sales') RETURNING id`
        );
        invoiceB = invBRes.rows[0].id;
    });

    afterAll(async () => {
        await db.close();
    });

    it('sanity: clients.nip is no longer globally unique (D1)', async () => {
        const res = await db.query(`SELECT COUNT(*) as count FROM clients WHERE nip = '${sharedNip}'`);
        expect(Number((res.rows[0] as any).count)).toBe(2);
    });

    it('sanity: UNIQUE(firm_id, nip) still rejects a true duplicate within one firm', async () => {
        await expect(
            db.exec(`INSERT INTO clients (nip, client_name, firm_id, auth_method) VALUES ('${sharedNip}', 'Dupe', ${firmA}, 'token')`)
        ).rejects.toThrow();
    });

    describe('invoices/[id]/xml and download route pattern: ownership check via i.firm_id', () => {
        const ownershipCheck = (invoiceId: number, requestingFirm: number) =>
            db.query(
                `SELECT i.id FROM invoices i WHERE i.id = $1 AND i.firm_id = $2`,
                [invoiceId, requestingFirm]
            );

        it('firm A can read its own invoice', async () => {
            const res = await ownershipCheck(invoiceA, firmA);
            expect(res.rows.length).toBe(1);
        });

        it('firm B cannot read firm A\'s invoice by guessing its id (fixed query)', async () => {
            const res = await ownershipCheck(invoiceA, firmB);
            expect(res.rows.length).toBe(0);
        });

        it('the OLD query shape (join on client_nip alone) would have leaked firm A\'s invoice to firm B', async () => {
            const oldShape = await db.query(
                `SELECT i.id FROM invoices i JOIN clients c ON i.client_nip = c.nip WHERE i.id = $1 AND c.firm_id = $2`,
                [invoiceA, firmB]
            );
            // This is the exact bug: firm B's client row shares the NIP, so the
            // join matches and the old WHERE c.firm_id = $2 wrongly authorizes it.
            expect(oldShape.rows.length).toBe(1);
        });
    });

    describe('invoices/route.ts list pattern: join scoped by firm_id on both sides', () => {
        const listInvoices = (requestingFirm: number) =>
            db.query(
                `SELECT i.id FROM invoices i JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id WHERE c.firm_id = $1`,
                [requestingFirm]
            );

        it("firm A's list contains only firm A's invoice", async () => {
            const res = await listInvoices(firmA);
            expect(res.rows.map((r: any) => r.id)).toEqual([invoiceA]);
        });

        it("firm B's list contains only firm B's invoice", async () => {
            const res = await listInvoices(firmB);
            expect(res.rows.map((r: any) => r.id)).toEqual([invoiceB]);
        });

        it('the OLD join (no firm_id in the ON clause) returns both firms\' invoices to either firm', async () => {
            const oldShape = await db.query(
                `SELECT i.id FROM invoices i JOIN clients c ON i.client_nip = c.nip WHERE c.firm_id = $1`,
                [firmA]
            );
            // Firm A's own client row (shared NIP) also joins to firm B's invoice
            // row, since the join never checked firm_id - both leak through.
            expect(oldShape.rows.length).toBe(2);
        });
    });

    describe('dashboard/page.tsx pattern: stats scoped directly by invoices.firm_id', () => {
        // Found live in the codebase (not in the original D1/D2 brief):
        // dashboard/page.tsx's three stats queries (status breakdown, weekly
        // chart, sales/purchase split) still used the client_nip join with no
        // firm_id in the ON clause - the exact leak shape D1/D2 fixed
        // everywhere else, on the one page every firm sees first after login.
        const statusBreakdown = (requestingFirm: number) =>
            db.query(
                `SELECT processing_status, COUNT(*) as count FROM invoices i WHERE i.firm_id = $1 GROUP BY processing_status`,
                [requestingFirm]
            );

        it("firm A's status breakdown counts only firm A's invoice", async () => {
            const res = await statusBreakdown(firmA);
            expect(res.rows.reduce((s: number, r: any) => s + Number(r.count), 0)).toBe(1);
        });

        it("firm B's status breakdown counts only firm B's invoice", async () => {
            const res = await statusBreakdown(firmB);
            expect(res.rows.reduce((s: number, r: any) => s + Number(r.count), 0)).toBe(1);
        });

        it('the OLD join (no firm_id in the ON clause) counts both firms\' invoices for either firm', async () => {
            const oldShape = await db.query(
                `SELECT COUNT(*) as count FROM invoices i JOIN clients c ON i.client_nip = c.nip WHERE c.firm_id = $1`,
                [firmA]
            );
            expect(Number((oldShape.rows[0] as any).count)).toBe(2);
        });
    });

    describe('jpk/generate/route.ts pattern: invoice fetch scoped by firm_id', () => {
        const fetchForJpk = (nip: string, requestingFirm: number) =>
            db.query(
                `SELECT id FROM invoices WHERE client_nip = $1 AND firm_id = $2`,
                [nip, requestingFirm]
            );

        it('only returns the requesting firm\'s invoice even though the NIP is shared', async () => {
            const res = await fetchForJpk(sharedNip, firmA);
            expect(res.rows.map((r: any) => r.id)).toEqual([invoiceA]);
        });

        it('the OLD query (client_nip only, as the brief found it) returns both firms\' invoices', async () => {
            const oldShape = await db.query(`SELECT id FROM invoices WHERE client_nip = $1`, [sharedNip]);
            expect(oldShape.rows.length).toBe(2);
        });
    });
});
