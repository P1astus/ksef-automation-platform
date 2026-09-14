import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// D8's online session flow never retrieved a UPO (Urzędowe Poświadczenie
// Odbioru — the legal proof-of-receipt KSeF issues per invoice), and never
// captured the real ksefNumber either (offline_invoices.ksef_number was
// getting sendInvoice()'s session-scoped referenceNumber instead). These
// tests verify getSessionInvoiceStatus()/downloadUpo() against the exact
// shapes in the vendored ksef-openapi.json (GET /sessions/{ref}/invoices'
// own documented example response), mocking global.fetch the same way
// ksef-client-encryption.test.ts already does for this file.

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
    return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe('getSessionInvoiceStatus / downloadUpo', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('parses the invoices array, including ksefNumber, upoDownloadUrl and status per invoice', async () => {
        const { getSessionInvoiceStatus } = await import('../ksef-client');
        // Shape taken directly from ksef-openapi.json's own documented
        // example for GET /sessions/{referenceNumber}/invoices.
        global.fetch = vi.fn(async (url: RequestInfo | URL) => {
            expect(String(url)).toContain('/sessions/SESSION-REF-1/invoices');
            return jsonResponse({
                invoices: [
                    {
                        ordinalNumber: 1,
                        invoiceNumber: 'FA/1/2026',
                        ksefNumber: '1111111111-20260914-ABCDEF-01',
                        referenceNumber: 'INV-REF-1',
                        invoiceHash: 'abc=',
                        acquisitionDate: '2026-09-14T12:00:00Z',
                        permanentStorageDate: '2026-09-14T12:00:05Z',
                        upoDownloadUrl: 'https://example.test/upo_1.xml?sig=abc',
                        upoDownloadUrlExpirationDate: '2026-09-17T12:00:00Z',
                        status: { code: 200, description: 'Sukces' },
                    },
                    {
                        ordinalNumber: 2,
                        referenceNumber: 'INV-REF-2',
                        invoiceHash: 'def=',
                        status: { code: 440, description: 'Duplikat faktury' },
                    },
                ],
            });
        }) as unknown as typeof fetch;

        const statuses = await getSessionInvoiceStatus('access-token', 'SESSION-REF-1');
        expect(statuses).toHaveLength(2);
        expect(statuses[0].ksefNumber).toBe('1111111111-20260914-ABCDEF-01');
        expect(statuses[0].upoDownloadUrl).toContain('upo_1.xml');
        expect(statuses[0].status.code).toBe(200);
        expect(statuses[1].status.code).toBe(440);
        expect(statuses[1].ksefNumber).toBeUndefined();
    });

    it('throws with the response body on a non-OK response', async () => {
        const { getSessionInvoiceStatus } = await import('../ksef-client');
        global.fetch = vi.fn(async () => jsonResponse({ error: 'nope' }, false, 404)) as unknown as typeof fetch;
        await expect(getSessionInvoiceStatus('t', 'ref')).rejects.toThrow(/404/);
    });

    it('downloadUpo fetches the pre-signed URL directly (no Bearer header) and returns the XML + hash', async () => {
        const { downloadUpo } = await import('../ksef-client');
        const fetchMock = vi.fn(async () => ({
            ok: true,
            text: async () => '<UPO>...</UPO>',
            headers: new Headers({ 'x-ms-meta-hash': 'base64hash==' }),
        })) as unknown as typeof fetch;
        global.fetch = fetchMock;

        const result = await downloadUpo('https://example.test/upo_1.xml?sig=abc');
        expect(result.xml).toBe('<UPO>...</UPO>');
        expect(result.hash).toBe('base64hash==');

        // No Authorization header — the SAS-style URL is self-authorizing.
        const callArgs = (fetchMock as any).mock.calls[0];
        expect(callArgs[1]?.headers).toBeUndefined();
    });

    it('downloadUpo throws on a failed download', async () => {
        const { downloadUpo } = await import('../ksef-client');
        global.fetch = vi.fn(async () => ({ ok: false, status: 403 })) as unknown as typeof fetch;
        await expect(downloadUpo('https://example.test/expired.xml')).rejects.toThrow(/403/);
    });
});
