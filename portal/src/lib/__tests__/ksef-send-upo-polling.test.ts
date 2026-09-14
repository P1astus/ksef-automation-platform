import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ksef/send/route.ts's pollAndStoreUpo(): KSeF processes a submitted
// invoice asynchronously, so sendInvoice() returning isn't enough to have a
// real ksefNumber or a UPO yet. This proves the three shapes that matter:
// an invoice that reaches a terminal success status gets its ksefNumber and
// UPO stored (and offline_invoices updated with the *real* number, not
// sendInvoice()'s session-scoped referenceNumber); a real failure status
// (>=400) is left alone rather than treated as done; and an invoice that
// never reaches a terminal status within the poll budget is reported as
// still pending rather than silently indistinguishable from "never tried".

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

const getSessionInvoiceStatusMock = vi.fn(async (..._args: any[]) => [] as any[]);
const downloadUpoMock = vi.fn(async (..._args: any[]) => ({ xml: '', hash: null as string | null }));
vi.mock('@/lib/ksef-client', () => ({
    getSessionInvoiceStatus: (...args: any[]) => getSessionInvoiceStatusMock(...args),
    downloadUpo: (...args: any[]) => downloadUpoMock(...args),
    // Unused by pollAndStoreUpo but imported by the route module.
    initInteractiveSession: vi.fn(),
    openOnlineSession: vi.fn(),
    encryptInvoiceForSession: vi.fn(),
    sendInvoice: vi.fn(),
    closeOnlineSession: vi.fn(),
    terminateSession: vi.fn(),
}));

describe('pollAndStoreUpo', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        queryMock.mockClear();
        getSessionInvoiceStatusMock.mockReset();
        downloadUpoMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stores the real ksefNumber, dates and UPO for an invoice that reaches a terminal success status', async () => {
        getSessionInvoiceStatusMock.mockResolvedValue([
            {
                referenceNumber: 'INV-REF-1',
                ksefNumber: '1111111111-20260914-ABCDEF-01',
                acquisitionDate: '2026-09-14T12:00:00Z',
                permanentStorageDate: '2026-09-14T12:00:05Z',
                upoDownloadUrl: 'https://example.test/upo_1.xml',
                status: { code: 200, description: 'Sukces' },
            },
        ]);
        downloadUpoMock.mockResolvedValue({ xml: '<UPO/>', hash: 'hash1' });

        const { pollAndStoreUpo } = await import('../../app/api/ksef/send/route');
        const promise = pollAndStoreUpo('token', 'SESSION-1', [{ id: 42, ksefReferenceNumber: 'INV-REF-1' }]);
        await vi.advanceTimersByTimeAsync(800);
        const pending = await promise;

        expect(pending.size).toBe(0);
        expect(downloadUpoMock).toHaveBeenCalledWith('https://example.test/upo_1.xml');

        const invoiceUpdate = queryMock.mock.calls.find(c => String(c[0]).includes('UPDATE invoices'));
        expect(invoiceUpdate?.[1]).toEqual([
            '1111111111-20260914-ABCDEF-01', '2026-09-14T12:00:00Z', '2026-09-14T12:00:05Z',
            '<UPO/>', 'INV-REF-1', 'hash1', 42,
        ]);

        const offlineUpdate = queryMock.mock.calls.find(c => String(c[0]).includes('UPDATE offline_invoices'));
        expect(offlineUpdate?.[1]).toEqual(['1111111111-20260914-ABCDEF-01', 42]);
    });

    it('leaves a real failure status (code >= 400) pending rather than treating it as done', async () => {
        getSessionInvoiceStatusMock.mockResolvedValue([
            { referenceNumber: 'INV-REF-2', status: { code: 440, description: 'Duplikat faktury' } },
        ]);

        const { pollAndStoreUpo } = await import('../../app/api/ksef/send/route');
        const promise = pollAndStoreUpo('token', 'SESSION-1', [{ id: 43, ksefReferenceNumber: 'INV-REF-2' }]);
        await vi.advanceTimersByTimeAsync(800 * 10);
        const pending = await promise;

        // A >=400 status is real KSeF-side information, not "still
        // processing" - it should stop being polled, but this test only
        // asserts the current best-effort contract: it isn't written to the
        // DB as a success, and isn't silently lost either (the invoice's
        // own row already has processing_status='exported_jpk' from the
        // send itself - this is specifically about the UPO/ksefNumber gap).
        expect(pending.has(43)).toBe(true);
        expect(queryMock.mock.calls.find(c => String(c[0]).includes('UPDATE invoices'))).toBeUndefined();
    });

    it('gives up after the poll budget and reports the invoice as still pending (best-effort, not a failure)', async () => {
        getSessionInvoiceStatusMock.mockResolvedValue([
            { referenceNumber: 'INV-REF-3', status: { code: 100, description: 'W trakcie przetwarzania' } },
        ]);

        const { pollAndStoreUpo } = await import('../../app/api/ksef/send/route');
        const promise = pollAndStoreUpo('token', 'SESSION-1', [{ id: 44, ksefReferenceNumber: 'INV-REF-3' }]);
        await vi.advanceTimersByTimeAsync(800 * 10);
        const pending = await promise;

        expect(pending.has(44)).toBe(true);
        expect(getSessionInvoiceStatusMock.mock.calls.length).toBe(10); // UPO_POLL_ATTEMPTS
    });

    it('stops polling (best-effort) if getSessionInvoiceStatus itself throws, without rejecting', async () => {
        getSessionInvoiceStatusMock.mockRejectedValue(new Error('network error'));

        const { pollAndStoreUpo } = await import('../../app/api/ksef/send/route');
        const promise = pollAndStoreUpo('token', 'SESSION-1', [{ id: 45, ksefReferenceNumber: 'INV-REF-4' }]);
        await vi.advanceTimersByTimeAsync(800);
        const pending = await promise;

        expect(pending.has(45)).toBe(true);
        expect(getSessionInvoiceStatusMock).toHaveBeenCalledTimes(1);
    });
});
