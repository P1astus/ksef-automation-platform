import { describe, it, expect, vi, beforeEach } from 'vitest';

// Round 11: PATCH /api/ocr-queue/[id]'s approve action used to SELECT
// ocr_status, check it wasn't already terminal, then only much later (after
// a client lookup, a firm lookup, and an invoice INSERT) write the terminal
// status back — a classic TOCTOU gap. Two concurrent approve requests for
// the same queue item both passed the early check before either write
// landed, so both inserted their own invoice for the same document. This
// simulates that race against an in-memory fake of the one ocr_queue row,
// modeling exactly what a real `UPDATE ... WHERE ocr_status NOT IN (...)
// RETURNING id` does — only one caller's claim can ever return a row.

vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => ({ firmId: 1 })),
    requireRole: vi.fn(async () => null),
}));

vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/client-cap', () => ({
    ClientLimitReachedError: class ClientLimitReachedError extends Error {},
    createClientWithinPlan: vi.fn(async () => true),
}));

let row: { id: number; ocr_status: string; firm_id: number };
let invoiceInserts: number;

const queryMock = vi.fn(async (...args: any[]) => {
    const [sql, params = []] = args as [string, any[]];
    if (sql.includes("UPDATE ocr_queue SET ocr_status = 'processing'")) {
        const [id, firmId] = params;
        if (String(row.id) === String(id) && row.firm_id === firmId && !['completed', 'failed', 'processing'].includes(row.ocr_status)) {
            row.ocr_status = 'processing';
            return { rows: [{ id: row.id }] };
        }
        return { rows: [] };
    }
    if (sql.startsWith('SELECT id FROM ocr_queue')) {
        return row ? { rows: [{ id: row.id }] } : { rows: [] };
    }
    if (sql.includes('INSERT INTO clients')) return { rows: [] };
    if (sql.includes('FROM firms')) return { rows: [{ firm_nip: '1234567890', firm_name: 'Firm A' }] };
    if (sql.includes('INSERT INTO invoices')) {
        invoiceInserts++;
        return { rows: [{ id: invoiceInserts }] };
    }
    if (sql.includes("UPDATE ocr_queue SET ocr_status = 'completed'")) {
        row.ocr_status = 'completed';
        return { rows: [] };
    }
    return { rows: [] };
});
vi.mock('@/lib/db', () => ({ query: (...args: any[]) => queryMock(...args) }));

function req(body: object) {
    return new Request('http://localhost/api/ocr-queue/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('PATCH /api/ocr-queue/[id] — approve race (round 11 fix)', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockClear();
        row = { id: 1, ocr_status: 'manual_review', firm_id: 1 };
        invoiceInserts = 0;
    });

    it('two concurrent approve requests for the same item: only one succeeds, only one invoice is created', async () => {
        const { PATCH } = await import('@/app/api/ocr-queue/[id]/route');
        const body = { action: 'approve', nip: '1112223334', invoiceNumber: 'FV/1', netAmount: 100, vatAmount: 23, grossAmount: 123 };
        const params = Promise.resolve({ id: '1' });

        const [res1, res2] = await Promise.all([
            PATCH(req(body), { params }),
            PATCH(req(body), { params }),
        ]);
        const statuses = [res1.status, res2.status].sort();

        expect(statuses).toEqual([200, 409]);
        expect(invoiceInserts).toBe(1);
    });

    it('approving an already-completed item returns 409 and creates no invoice', async () => {
        row.ocr_status = 'completed';
        const { PATCH } = await import('@/app/api/ocr-queue/[id]/route');
        const res = await PATCH(
            req({ action: 'approve', nip: '1112223334', invoiceNumber: 'FV/1' }),
            { params: Promise.resolve({ id: '1' }) }
        );
        expect(res.status).toBe(409);
        expect(invoiceInserts).toBe(0);
    });

    it('an invalid action returns 400 without touching ocr_status', async () => {
        const { PATCH } = await import('@/app/api/ocr-queue/[id]/route');
        const res = await PATCH(
            req({ action: 'bogus' }),
            { params: Promise.resolve({ id: '1' }) }
        );
        expect(res.status).toBe(400);
        expect(row.ocr_status).toBe('manual_review');
        expect(queryMock).not.toHaveBeenCalled();
    });
});
