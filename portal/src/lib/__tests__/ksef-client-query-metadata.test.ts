import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// queryInvoices() used to send `type: 'Received'|'Issued'`, no subjectType/dateType, and pageOffset in the body: none of
// that is in the API contract (subjectType and dateRange.dateType are REQUIRED; paging is in the query string). Nothing
// called it, so nothing noticed. This pins the request to the vendored spec.

const SPEC = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'ksef-openapi.json'), 'utf8'));
const op = SPEC.paths['/invoices/query/metadata'].post;

afterEach(() => vi.unstubAllGlobals());

async function capture() {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ invoices: [], hasMore: false, isTruncated: false, permanentStorageHwmDate: '2026-09-21T09:00:00Z' }), { status: 200 });
    }));
    const { queryInvoices } = await import('../ksef-client');
    const page = await queryInvoices('tok', { subjectType: 'Subject2', dateFrom: '2026-09-01T00:00:00.000Z', dateTo: '2026-09-21T10:00:00.000Z', pageOffset: 3, pageSize: 250 });
    return { seen: seen[0], page };
}

describe('queryInvoices matches the KSeF spec', () => {
    it('sends the required subjectType and dateRange.dateType, PermanentStorage, restricted to the HWM', async () => {
        const { seen } = await capture();
        const body = JSON.parse(String(seen.init.body));
        expect(body.subjectType).toBe('Subject2');
        expect(body.dateRange).toEqual({ dateType: 'PermanentStorage', from: '2026-09-01T00:00:00.000Z', to: '2026-09-21T10:00:00.000Z', restrictToPermanentStorageHwmDate: true });
        expect(body).not.toHaveProperty('type');
        expect(body).not.toHaveProperty('pageOffset');
        // every property we send exists in the spec
        const filters = SPEC.components.schemas.InvoiceQueryFilters;
        for (const k of Object.keys(body)) expect(Object.keys(filters.properties)).toContain(k);
        for (const r of filters.required) expect(body).toHaveProperty(r);
    });

    it('pages by query string, ascending, on the documented endpoint', async () => {
        const { seen } = await capture();
        const url = new URL(seen.url);
        expect(url.pathname.endsWith('/invoices/query/metadata')).toBe(true);
        expect(url.searchParams.get('sortOrder')).toBe('Asc');
        expect(url.searchParams.get('pageOffset')).toBe('3');
        expect(url.searchParams.get('pageSize')).toBe('250');
        const names = op.parameters.map((p: any) => p.name);
        for (const k of url.searchParams.keys()) expect(names).toContain(k);
        expect(seen.init.method).toBe('POST');
        expect((seen.init.headers as any).Authorization).toBe('Bearer tok');
    });

    it('returns hasMore / isTruncated / permanentStorageHwmDate as the API does', async () => {
        const { page } = await capture();
        expect(page).toMatchObject({ hasMore: false, isTruncated: false, permanentStorageHwmDate: '2026-09-21T09:00:00Z' });
    });

    it('refuses a pageSize outside the documented 10-250 rather than sending a request KSeF will reject', async () => {
        vi.stubGlobal('fetch', vi.fn());
        const { queryInvoices } = await import('../ksef-client');
        await expect(queryInvoices('t', { subjectType: 'Subject1', dateFrom: 'a', dateTo: 'b', pageSize: 5 })).rejects.toThrow(/between 10 and 250/);
        await expect(queryInvoices('t', { subjectType: 'Subject1', dateFrom: 'a', dateTo: 'b', pageSize: 300 })).rejects.toThrow(/between 10 and 250/);
    });
});
