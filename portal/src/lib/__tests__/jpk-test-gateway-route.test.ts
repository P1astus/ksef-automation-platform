import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(), requireRole: vi.fn(), requireActiveSubscription: vi.fn(), query: vi.fn(),
    prepare: vi.fn(), sign: vi.fn(), submit: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession, requireRole: mocks.requireRole }));
vi.mock('@/lib/entitlements', () => ({ requireActiveSubscription: mocks.requireActiveSubscription }));
vi.mock('@/lib/db', () => ({ query: (...args: unknown[]) => mocks.query(...args) }));
vi.mock('@/lib/jpk-gateway', () => ({
    JpkGatewayError: class JpkGatewayError extends Error { detail?: unknown },
    prepareJpkUpload: (...args: unknown[]) => mocks.prepare(...args),
    signInitUploadWithSidecar: (...args: unknown[]) => mocks.sign(...args),
    submitToTestGateway: (...args: unknown[]) => mocks.submit(...args),
}));

import { GET, POST } from '@/app/api/jpk/test-gateway/route';

const post = (body: object) => POST(new Request('http://x/api/jpk/test-gateway', { method: 'POST', body: JSON.stringify(body) }));

describe('JPK TEST gateway route', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.JPK_TEST_GATEWAY_ENABLED = 'true';
        process.env.JPK_TEST_GATEWAY_CERTIFICATE_PEM = 'public-test-certificate';
        mocks.getSession.mockResolvedValue({ firmId: 7, adminEmail: 'owner@example.test', userId: null, role: 'owner' });
        mocks.requireRole.mockResolvedValue(null);
        mocks.requireActiveSubscription.mockResolvedValue(null);
        mocks.prepare.mockReturnValue({ initUploadXml: '<InitUpload/>', parts: [] });
        mocks.sign.mockResolvedValue('<Signed/>');
        mocks.submit.mockResolvedValue({ referenceNumber: 'MF-REF-1', status: { code: 419, description: 'błąd w danych autoryzujących', details: 'verbatim MF detail' } });
    });

    it('is disabled by default and cannot make a gateway call', async () => {
        delete process.env.JPK_TEST_GATEWAY_ENABLED;
        const res = await post({ clientNip: '1234567890', period: '2026-09' });
        expect(res.status).toBe(403);
        expect(mocks.submit).not.toHaveBeenCalled();
    });

    it('enforces an active subscription before allowing an enabled TEST submission', async () => {
        mocks.requireActiveSubscription.mockResolvedValue(new Response(JSON.stringify({ code: 'SUBSCRIPTION_INACTIVE' }), { status: 402 }));
        const res = await post({ clientNip: '1234567890', period: '2026-09' });
        expect(res.status).toBe(402);
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.submit).not.toHaveBeenCalled();
    });

    it('requires a generated JPK scoped to the current firm before external submission', async () => {
        mocks.query.mockResolvedValue({ rows: [] });
        const res = await post({ clientNip: '1234567890', period: '2026-09' });
        expect(res.status).toBe(409);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('firm_id = $1 AND client_nip = $2'), [7, '1234567890', '2026-09']);
        expect(mocks.submit).not.toHaveBeenCalled();
    });

    it('audits a tenant-scoped TEST submission and preserves MF rejection text verbatim', async () => {
        mocks.query
            .mockResolvedValueOnce({ rows: [{ export_data: '<JPK/>' }] })
            .mockResolvedValueOnce({ rows: [{ id: 42 }] })
            .mockResolvedValueOnce({ rows: [] });
        const res = await post({ clientNip: '1234567890', period: '2026-09' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ submission: { referenceNumber: 'MF-REF-1', status: 'rejected', code: 419, description: 'błąd w danych autoryzujących' } });
        expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ xml: '<JPK/>', fileName: 'JPK_V7M_1234567890_2026-09.xml' }));
        expect(mocks.sign).toHaveBeenCalledWith('<InitUpload/>');
        expect(mocks.query.mock.calls[2]).toEqual([
            expect.stringContaining("SET reference_number = $1, status = $2"),
            ['MF-REF-1', 'rejected', 419, 'błąd w danych autoryzujących', 'verbatim MF detail', null, 42, 7],
        ]);
    });

    it('lists submissions only for the authenticated firm, never another tenant', async () => {
        mocks.query.mockResolvedValue({ rows: [] });
        const res = await GET(new Request('http://x/api/jpk/test-gateway?clientNip=1234567890'));
        expect(res.status).toBe(200);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE firm_id = $1 AND client_nip = $2'), [7, '1234567890']);
    });

    it('records a signing/gateway failure and returns its exact error', async () => {
        mocks.sign.mockRejectedValue(new Error('JPK signing key is not configured on the sidecar'));
        mocks.query
            .mockResolvedValueOnce({ rows: [{ export_data: '<JPK/>' }] })
            .mockResolvedValueOnce({ rows: [{ id: 42 }] })
            .mockResolvedValueOnce({ rows: [] });
        const res = await post({ clientNip: '1234567890', period: '2026-09' });
        expect(res.status).toBe(502);
        expect((await res.json()).error).toBe('JPK signing key is not configured on the sidecar');
        expect(mocks.query.mock.calls[2]).toEqual([
            expect.stringContaining("SET status = 'error'"),
            ['JPK signing key is not configured on the sidecar', 42, 7],
        ]);
    });
});
