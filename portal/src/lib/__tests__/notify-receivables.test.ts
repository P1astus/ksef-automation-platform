import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/notify/receivables — an informational weekly digest to the firm's
// own client about their own overdue receivables. Proves invoices are
// grouped per client (one email per client, not one per overdue invoice)
// and that the query only ever considers sales invoices with an actual
// due_date in the past — not a dunning notice to the buyer, who has no
// contact info captured anywhere.

const queryMock = vi.fn(async (..._args: any[]) => ({ rows: [] as any[] }));
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

const sendReceivablesDigestMock = vi.fn(async (..._args: any[]) => {});
vi.mock('@/lib/email', () => ({ sendReceivablesDigest: (...args: any[]) => sendReceivablesDigestMock(...args) }));

function req(auth?: string) {
    return new Request('http://localhost/api/notify/receivables', {
        method: 'POST',
        headers: auth ? { Authorization: auth } : {},
    });
}

describe('POST /api/notify/receivables', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        sendReceivablesDigestMock.mockReset();
        delete process.env.NOTIFY_SECRET;
    });

    it('rejects a wrong secret when NOTIFY_SECRET is set', async () => {
        process.env.NOTIFY_SECRET = 'right-secret';
        const { POST } = await import('@/app/api/notify/receivables/route');
        const res = await POST(req('Bearer wrong'));
        expect(res.status).toBe(401);
    });

    it('groups multiple overdue invoices for the same client into one email', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [
                { client_id: 1, contact_email: 'c@example.com', client_name: 'Client A', invoice_number: 'FV/1', gross_amount: '100.00', due_date: '2026-08-01' },
                { client_id: 1, contact_email: 'c@example.com', client_name: 'Client A', invoice_number: 'FV/2', gross_amount: '200.00', due_date: '2026-08-15' },
            ],
        });
        const { POST } = await import('@/app/api/notify/receivables/route');
        const res = await POST(req());
        const body = await res.json();

        expect(body.clientsWithOverdue).toBe(1);
        expect(body.sent).toBe(1);
        expect(sendReceivablesDigestMock).toHaveBeenCalledTimes(1);
        const [, , invoices] = sendReceivablesDigestMock.mock.calls[0];
        expect(invoices).toHaveLength(2);
    });

    it('sends a separate email per distinct client', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [
                { client_id: 1, contact_email: 'a@example.com', client_name: 'Client A', invoice_number: 'FV/1', gross_amount: '100.00', due_date: '2026-08-01' },
                { client_id: 2, contact_email: 'b@example.com', client_name: 'Client B', invoice_number: 'FV/9', gross_amount: '50.00', due_date: '2026-08-10' },
            ],
        });
        const { POST } = await import('@/app/api/notify/receivables/route');
        const res = await POST(req());
        const body = await res.json();
        expect(body.clientsWithOverdue).toBe(2);
        expect(sendReceivablesDigestMock).toHaveBeenCalledTimes(2);
    });

    it("the query only considers 'sales' direction and unpaid, past-due invoices", async () => {
        queryMock.mockResolvedValueOnce({ rows: [] });
        const { POST } = await import('@/app/api/notify/receivables/route');
        await POST(req());
        const sql = String(queryMock.mock.calls[0][0]);
        expect(sql).toMatch(/direction = 'sales'/);
        expect(sql).toMatch(/payment_status = 'unpaid'/);
        expect(sql).toMatch(/due_date < NOW\(\)/);
    });
});
