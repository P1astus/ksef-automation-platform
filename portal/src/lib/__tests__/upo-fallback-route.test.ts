import { describe, it, expect, vi, beforeEach } from 'vitest';

// invoices/[id]/upo/route.ts used to have no fallback at all: if
// pollAndStoreUpo() (ksef/send/route.ts) never got upo_xml stored - most
// realistically because the pre-signed upoDownloadUrl had already expired
// by the time it tried to fetch it - the route just told the user "try
// again later" forever, with nothing that would ever actually retry.
// Round 6 fix: retry live via the authenticated
// GET /sessions/{referenceNumber}/invoices/ksef/{ksefNumber}/upo endpoint,
// using the online session's reference number persisted at send time
// (ksef_session_reference_number) plus a freshly re-authenticated token.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1 })),
}));

const initInteractiveSessionMock = vi.fn(async (..._args: any[]) => 'fresh-access-token');
const downloadUpoByKsefNumberMock = vi.fn(async (..._args: any[]) => ({ xml: '<UPO>retried</UPO>', hash: 'hash==' }));
vi.mock('@/lib/ksef-client', () => ({
    initInteractiveSession: (...args: any[]) => initInteractiveSessionMock(...args),
    downloadUpoByKsefNumber: (...args: any[]) => downloadUpoByKsefNumberMock(...args),
}));

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

function req() {
    return new Request('http://localhost/api/invoices/1/upo');
}

describe('invoices/[id]/upo/route.ts — live fallback when upo_xml is missing', () => {
    beforeEach(() => {
        vi.resetModules();
        initInteractiveSessionMock.mockClear();
        downloadUpoByKsefNumberMock.mockClear();
        queryMock.mockReset();
    });

    it('returns the stored UPO directly without attempting a retry when already present', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [{ upo_xml: '<UPO>stored</UPO>', upo_retrieved_at: '2026-09-14T10:00:00Z', ksef_number: 'K-1', ksef_session_reference_number: 'SESSION-1', nip: '1111111111', ksef_token_encrypted: Buffer.from('token').toString('base64') }],
        });
        const { GET } = await import('@/app/api/invoices/[id]/upo/route');
        const res = await GET(req(), { params: Promise.resolve({ id: '1' }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.upoXml).toBe('<UPO>stored</UPO>');
        expect(initInteractiveSessionMock).not.toHaveBeenCalled();
    });

    it('returns 404 without attempting a retry when the invoice was never sent to KSeF', async () => {
        queryMock.mockResolvedValueOnce({ rows: [{ upo_xml: null, ksef_number: null, ksef_session_reference_number: null, nip: null, ksef_token_encrypted: null }] });
        const { GET } = await import('@/app/api/invoices/[id]/upo/route');
        const res = await GET(req(), { params: Promise.resolve({ id: '1' }) });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toMatch(/nie została jeszcze wysłana/i);
        expect(initInteractiveSessionMock).not.toHaveBeenCalled();
    });

    it('retries live via the authenticated endpoint when upo_xml is missing but the session reference and token are on file, and stores the result', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [{ upo_xml: null, ksef_number: '1111111111-20260914-ABCDEF-01', ksef_session_reference_number: 'SESSION-1', nip: '1111111111', ksef_token_encrypted: Buffer.from('plaintext-token').toString('base64') }],
        });
        queryMock.mockResolvedValueOnce({ rows: [] }); // the UPDATE storing the retried UPO

        const { GET } = await import('@/app/api/invoices/[id]/upo/route');
        const res = await GET(req(), { params: Promise.resolve({ id: '1' }) });

        expect(initInteractiveSessionMock).toHaveBeenCalledWith('1111111111', 'plaintext-token');
        expect(downloadUpoByKsefNumberMock).toHaveBeenCalledWith('fresh-access-token', 'SESSION-1', '1111111111-20260914-ABCDEF-01');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.upoXml).toBe('<UPO>retried</UPO>');

        const updateCall = queryMock.mock.calls.find((c: any[]) => String(c[0]).includes('UPDATE invoices SET upo_xml'));
        expect(updateCall![1]).toEqual(['<UPO>retried</UPO>', 'hash==', '1']);
    });

    it('falls through to the "not yet available" response when the live retry itself fails, not a 500', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [{ upo_xml: null, ksef_number: 'K-1', ksef_session_reference_number: 'SESSION-1', nip: '1111111111', ksef_token_encrypted: Buffer.from('token').toString('base64') }],
        });
        downloadUpoByKsefNumberMock.mockRejectedValueOnce(new Error('UPO retry download failed (400): not found'));

        const { GET } = await import('@/app/api/invoices/[id]/upo/route');
        const res = await GET(req(), { params: Promise.resolve({ id: '1' }) });
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toMatch(/spróbuj ponownie/i);
    });

    it('does not attempt a retry when no session reference number was ever persisted (invoice sent before round 6)', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [{ upo_xml: null, ksef_number: 'K-1', ksef_session_reference_number: null, nip: '1111111111', ksef_token_encrypted: Buffer.from('token').toString('base64') }],
        });
        const { GET } = await import('@/app/api/invoices/[id]/upo/route');
        const res = await GET(req(), { params: Promise.resolve({ id: '1' }) });
        expect(res.status).toBe(404);
        expect(initInteractiveSessionMock).not.toHaveBeenCalled();
    });
});
