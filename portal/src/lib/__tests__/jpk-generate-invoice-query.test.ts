import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

// Round 18 joined `invoices original` into jpk/generate's invoice SELECT (to
// read a corrected invoice's original lines) and left the other columns
// unqualified: every column both tables share became "ambiguous", so the live
// route 500'd on every request. Generator unit tests never run the route's SQL,
// so this captures the statement the route actually sends and executes it.
describe('jpk/generate invoice query', () => {
    it('is valid SQL with the corrections join and returns the original lines', async () => {
        vi.resetModules();
        let invoiceSql = '';
        let invoiceParams: unknown[] = [];
        const queryMock = vi.fn(async (sql: string, params?: unknown[]) => {
            if (sql.includes('FROM clients')) return { rows: [{ id: 1, nip: '5260250274', client_name: 'A', tax_office_code: '1471', contact_email: 'a@example.com' }] };
            if (sql.includes('FROM firms')) return { rows: [{ firm_name: 'F' }] };
            if (sql.includes('FROM invoices i')) { invoiceSql = sql; invoiceParams = params || []; return { rows: [] }; }
            return { rows: [] };
        });
        vi.doMock('@/lib/db', () => ({ query: queryMock }));
        vi.doMock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ firmId: 1 })), requireRole: vi.fn(async () => null) }));
        vi.doMock('@/lib/entitlements', () => ({ requireActiveSubscription: vi.fn(async () => null) }));
        vi.doMock('@/lib/activity', () => ({ logActivity: vi.fn() }));
        const { POST } = await import('@/app/api/jpk/generate/route');
        await POST(new Request('http://x/api/jpk/generate', { method: 'POST', body: JSON.stringify({ clientNip: '5260250274', period: '2026-09' }) }));
        expect(invoiceSql).toContain('LEFT JOIN invoices original');

        const db = new PGlite();
        await db.exec(`CREATE TABLE invoices (
            id serial primary key, firm_id int, client_nip text, invoice_number text, issue_date date,
            seller_name text, seller_nip text, buyer_name text, buyer_nip text,
            net_amount numeric, vat_amount numeric, gross_amount numeric, direction text,
            jpk_marker text, jpk_period text, jpk_correction_needed boolean, ksef_number text,
            cost_category text, invoice_lines jsonb, jpk_gtu text[], jpk_procedures text[],
            jpk_doc_type text, jpk_import boolean, delivery_date date, ksef_acquisition_date timestamptz,
            jpk_counterparty_country text, jpk_margin_gross numeric, jpk_margin_taxable_gross numeric,
            jpk_margin_vat_rate text, jpk_margin_method text, corrects_invoice_id int)`);
        await db.query(`INSERT INTO invoices (id, firm_id, client_nip, invoice_number, issue_date, invoice_lines) VALUES (1, 1, '5260250274', 'A', '2026-09-10', '[{"name":"x"}]')`);
        await db.query(`INSERT INTO invoices (id, firm_id, client_nip, invoice_number, issue_date, corrects_invoice_id) VALUES (2, 1, '5260250274', 'K', '2026-09-11', 1)`);
        const res = await db.query<{ invoice_number: string; corrected_original_lines: unknown }>(invoiceSql.replace(/\$(\d)/g, (_, n) => `$${n}`), invoiceParams);
        const k = res.rows.find(r => r.invoice_number === 'K');
        expect(k?.corrected_original_lines).toEqual([{ name: 'x' }]);
        expect(res.rows.find(r => r.invoice_number === 'A')?.corrected_original_lines).toBeNull();
    });
});
