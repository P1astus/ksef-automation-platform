import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// D8: sendInvoice() expected a pre-encrypted payload but nothing produced
// one, and ksef/send/route.ts called it with 2 args where it needs 3 - the
// route was also passing the auth accessToken where a KSeF *online session*
// referenceNumber belongs, since nothing ever opened one. Fixed by adding
// openOnlineSession() (POST /sessions/online, using a SymmetricKeyEncryption
// cert - a different cert than the auth flow's KsefTokenEncryption one) and
// encryptInvoiceForSession() (delegates AES-256-CBC/PKCS7 encryption to the
// XAdES sidecar, per ksef-openapi.json's SendInvoiceRequest schema - not
// AES-256-GCM, contrary to this codebase's earlier notes).
//
// These tests mock global.fetch to verify the request/response shapes match
// the vendored spec, without hitting the real network.

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

describe('ksef-client.ts online session encryption flow (D8)', () => {
    beforeEach(() => {
        vi.resetModules();
        // Round 4: every sidecar call now requires this header - unrelated to
        // what these tests are checking, so stub it rather than have it fail
        // every mocked fetch with "SIDECAR_API_KEY is not set".
        vi.stubEnv('SIDECAR_API_KEY', 'test-sidecar-key');
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.unstubAllEnvs();
    });

    it('getPublicKeyCertificate fetches the certificate matching the requested usage, not just the first one', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (url.includes('/security/public-key-certificates')) {
                return jsonResponse([
                    { certificate: 'CERT_TOKEN', usage: ['KsefTokenEncryption'] },
                    { certificate: 'CERT_SYMKEY', usage: ['SymmetricKeyEncryption'] },
                ]);
            }
            throw new Error(`unexpected fetch: ${url}`);
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const { getPublicKeyCertificate } = await import('@/lib/ksef-client');
        await expect(getPublicKeyCertificate('SymmetricKeyEncryption')).resolves.toBe('CERT_SYMKEY');
        await expect(getPublicKeyCertificate('KsefTokenEncryption')).resolves.toBe('CERT_TOKEN');
    });

    it('openOnlineSession fetches the SymmetricKeyEncryption cert, asks the sidecar to generate a key, and opens the session with FA(3) + the wrapped key', async () => {
        const calls: { url: string; body: unknown }[] = [];
        const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
            const body = opts?.body ? JSON.parse(opts.body as string) : undefined;
            calls.push({ url, body });

            if (url.includes('/security/public-key-certificates')) {
                return jsonResponse([{ certificate: 'CERT_SYMKEY', usage: ['SymmetricKeyEncryption'] }]);
            }
            if (url.includes('/generate-session-key')) {
                return jsonResponse({ keyBase64: 'KEY==', ivBase64: 'IV==', encryptedKeyBase64: 'ENCKEY==', success: true });
            }
            if (url.includes('/sessions/online') && opts?.method === 'POST') {
                return jsonResponse({ referenceNumber: '20260101-SO-ABCDEF0000-0123456789-01', validUntil: '2026-01-01T12:00:00Z' });
            }
            throw new Error(`unexpected fetch: ${url}`);
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        const { openOnlineSession } = await import('@/lib/ksef-client');
        const result = await openOnlineSession('access-token-123');

        expect(result).toEqual({
            referenceNumber: '20260101-SO-ABCDEF0000-0123456789-01',
            validUntil: '2026-01-01T12:00:00Z',
            keyBase64: 'KEY==',
            ivBase64: 'IV==',
        });

        const sidecarCall = calls.find(c => c.url.includes('/generate-session-key'));
        expect(sidecarCall?.body).toEqual({ ksefPublicKeyPem: 'CERT_SYMKEY' });

        const openCall = calls.find(c => c.url.includes('/sessions/online'));
        expect(openCall?.body).toEqual({
            formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' },
            encryption: {
                encryptedSymmetricKey: 'ENCKEY==',
                initializationVector: 'IV==',
            },
        });

        const authHeader = (fetchMock.mock.calls.find(([u]) => (u as string).includes('/sessions/online'))?.[1] as RequestInit)
            ?.headers as Record<string, string>;
        expect(authHeader['Authorization']).toBe('Bearer access-token-123');
    });

    it('openOnlineSession surfaces a clear error when the session-open call fails, rather than swallowing it', async () => {
        global.fetch = vi.fn(async (url: string) => {
            if (url.includes('/security/public-key-certificates')) {
                return jsonResponse([{ certificate: 'CERT_SYMKEY', usage: ['SymmetricKeyEncryption'] }]);
            }
            if (url.includes('/generate-session-key')) {
                return jsonResponse({ keyBase64: 'KEY==', ivBase64: 'IV==', encryptedKeyBase64: 'ENCKEY==' });
            }
            if (url.includes('/sessions/online')) {
                return jsonResponse({ exceptionDetail: 'invalid formCode' }, false, 400);
            }
            throw new Error(`unexpected fetch: ${url}`);
        }) as unknown as typeof fetch;

        const { openOnlineSession } = await import('@/lib/ksef-client');
        await expect(openOnlineSession('token')).rejects.toThrow(/sessions\/online.*failed.*400/);
    });

    it('encryptInvoiceForSession delegates to the sidecar with the session key/IV and returns the SendInvoiceRequest shape', async () => {
        const calls: { url: string; body: unknown }[] = [];
        global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
            calls.push({ url, body: opts?.body ? JSON.parse(opts.body as string) : undefined });
            if (url.includes('/encrypt-invoice')) {
                return jsonResponse({
                    invoiceHash: 'HASH==',
                    invoiceSize: 43,
                    encryptedInvoiceHash: 'EHASH==',
                    encryptedInvoiceSize: 48,
                    encryptedInvoiceContent: 'CIPHERTEXT==',
                    success: true,
                });
            }
            throw new Error(`unexpected fetch: ${url}`);
        }) as unknown as typeof fetch;

        const { encryptInvoiceForSession } = await import('@/lib/ksef-client');
        const result = await encryptInvoiceForSession('<Faktura/>', 'KEY==', 'IV==');

        expect(calls[0].body).toEqual({ invoiceXml: '<Faktura/>', keyBase64: 'KEY==', ivBase64: 'IV==' });
        expect(result).toEqual({
            invoiceHash: 'HASH==',
            invoiceSize: 43,
            encryptedInvoiceHash: 'EHASH==',
            encryptedInvoiceSize: 48,
            encryptedInvoiceContent: 'CIPHERTEXT==',
            success: true,
        });
    });

    it('closeOnlineSession posts to /sessions/online/{referenceNumber}/close and never throws (non-critical)', async () => {
        const fetchMock = vi.fn(async () => { throw new Error('network down'); });
        global.fetch = fetchMock as unknown as typeof fetch;

        const { closeOnlineSession } = await import('@/lib/ksef-client');
        await expect(closeOnlineSession('token', 'REF-1')).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/sessions/online/REF-1/close'),
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('sendInvoice posts the encrypted payload to /sessions/online/{referenceNumber}/invoices', async () => {
        const calls: { url: string; body: unknown }[] = [];
        global.fetch = vi.fn(async (url: string, opts?: RequestInit) => {
            calls.push({ url, body: opts?.body ? JSON.parse(opts.body as string) : undefined });
            return jsonResponse({ referenceNumber: 'INV-REF-1' });
        }) as unknown as typeof fetch;

        const { sendInvoice } = await import('@/lib/ksef-client');
        const payload = {
            invoiceHash: 'HASH==',
            invoiceSize: 43,
            encryptedInvoiceHash: 'EHASH==',
            encryptedInvoiceSize: 48,
            encryptedInvoiceContent: 'CIPHERTEXT==',
        };
        const ref = await sendInvoice('access-token', 'SESSION-REF', payload);

        expect(ref).toBe('INV-REF-1');
        expect(calls[0].url).toContain('/sessions/online/SESSION-REF/invoices');
        expect(calls[0].body).toEqual({ ...payload, offlineMode: false });
    });
});
