import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Ministry of Finance white-list lookup is only used from dashboard pages;
// unauthenticated callers must not be able to use the portal as a proxy.
const getSession = vi.fn();
vi.mock('@/lib/auth', () => ({ getSession: () => getSession() }));
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { subject: { name: 'X', nip: '1234563218', statusVat: 'Czynny' } } })));
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => { fetchMock.mockClear(); getSession.mockReset(); });

describe('GET /api/gus', () => {
    it('requires a session and does not call the upstream service without one', async () => {
        getSession.mockResolvedValue(null);
        const { GET } = await import('@/app/api/gus/route');
        const res = await GET(new Request('http://localhost/api/gus?nip=1234563218'));
        expect(res.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('still answers a signed-in user', async () => {
        getSession.mockResolvedValue({ firmId: 1, role: 'member' });
        const { GET } = await import('@/app/api/gus/route');
        const res = await GET(new Request('http://localhost/api/gus?nip=1234563218'));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ found: true, vatStatus: 'active' });
    });
});
