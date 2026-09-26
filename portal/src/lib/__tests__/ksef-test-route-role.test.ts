import { describe, expect, it, vi } from 'vitest';

// The KSeF diagnostic authenticates to KSeF with a client's stored token;
// like saving that token (settings/ksef), it is an owner/admin action.
vi.mock('@/lib/auth', async () => {
    const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
    return { ...actual, getSession: vi.fn(async () => ({ firmId: 1, role: 'readonly', userId: 5 })) };
});
const queryMock = vi.fn(async () => ({ rows: [] }));
vi.mock('@/lib/db', () => ({ query: (...a: unknown[]) => queryMock(...(a as [])) }));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('GET /api/ksef/test', () => {
    it('refuses read-only members before contacting KSeF or reading credentials', async () => {
        const { GET } = await import('@/app/api/ksef/test/route');
        const res = await GET(new Request('http://localhost/api/ksef/test?clientId=1'));
        expect(res.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(queryMock).not.toHaveBeenCalled();
    });
});
