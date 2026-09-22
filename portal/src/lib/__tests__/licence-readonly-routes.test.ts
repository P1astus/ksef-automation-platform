import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({
    query: vi.fn(),
    entitlements: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ firmId: 1, role: 'owner' }), requireRole: async () => null }));
vi.mock('@/lib/db', () => ({ query: (...a: unknown[]) => mock.query(...a) }));
vi.mock('@/lib/entitlements', () => ({
    loadEntitlements: (...a: unknown[]) => mock.entitlements(...a),
    subscriptionInactiveResponse: (state: string) => Response.json({ error: 'Licencja wygasła', code: 'SUBSCRIPTION_INACTIVE', state }, { status: 402 }),
    upgradeRequiredResponse: () => Response.json({}, { status: 403 }),
}));
vi.mock('@/lib/ksef-client', () => ({ initInteractiveSession: vi.fn(), openOnlineSession: vi.fn(), encryptInvoiceForSession: vi.fn(), sendInvoice: vi.fn(), closeOnlineSession: vi.fn(), terminateSession: vi.fn(), getSessionInvoiceStatus: vi.fn(), downloadUpo: vi.fn() }));
vi.mock('@/lib/credential-crypto', () => ({ clientCredentialContext: vi.fn(), decryptSecret: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn() }));

import { POST } from '../../app/api/ksef/send/route';
import { GET as download } from '../../app/api/invoices/[id]/download/route';

const req = (ids: number[]) => new Request('https://example.test/api/ksef/send', { method: 'POST', body: JSON.stringify({ invoiceIds: ids }) });
const invoice = (id: number) => ({ id, invoice_number: `INV-${id}`, raw_xml: '<xml/>', direction: 'sales', client_id: 2, nip: '1234567890', client_name: 'Test', ksef_token_encrypted: null });
beforeEach(() => {
    mock.query.mockReset(); mock.entitlements.mockReset();
    mock.entitlements.mockResolvedValue({ accessState: 'licence_expired', has: () => false });
});

describe('expired licence keeps legal and recovery reads', () => {
    it('blocks an ordinary invoice send with structured 402', async () => {
        mock.query.mockResolvedValueOnce({ rows: [invoice(1)] }).mockResolvedValueOnce({ rows: [] });
        const result = await POST(req([1]));
        expect(result.status).toBe(402);
        expect((await result.json()).state).toBe('licence_expired');
    });
    it('allows only OPEN offline invoices through the send gate', async () => {
        mock.query.mockResolvedValueOnce({ rows: [invoice(1)] }).mockResolvedValueOnce({ rows: [{ invoice_id: 1 }] });
        const result = await POST(req([1]));
        expect(result.status).toBe(200);
        expect((await result.json()).results[0].error).toMatch(/Brak tokenu/);
    });
    it('keeps invoice XML download available without consulting entitlements', async () => {
        mock.query.mockResolvedValueOnce({ rows: [{ raw_xml: '<xml/>', invoice_number: 'INV-1' }] });
        const result = await download(new Request('https://example.test/api/invoices/1/download') as never, { params: Promise.resolve({ id: '1' }) });
        expect(result.status).toBe(200);
        expect(await result.text()).toBe('<xml/>');
        expect(mock.entitlements).not.toHaveBeenCalled();
    });
});
