import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unauthenticated write routes are throttled with the shared DB-backed limiter:
// a document-request link (valid for 7 days) cannot be used to fill the upload
// volume, and hosted self-registration cannot be scripted to mass-create firms
// (each one can send invitation e-mails to arbitrary addresses).
const consumeRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', async () => {
    const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
    return { ...actual, consumeRateLimit: (...a: unknown[]) => consumeRateLimit(...a) };
});
const queryMock = vi.fn(async (sql: string) => (/FROM document_requests/.test(sql)
    ? { rows: [{ firm_id: 1, client_id: 2, expires_at: new Date(Date.now() + 3600_000), client_nip: '1234563218', client_name: 'C' }] }
    : { rows: [] }));
vi.mock('@/lib/db', () => ({ query: (sql: string, p?: unknown[]) => queryMock(sql, p), default: { connect: vi.fn() } }));
vi.mock('@/lib/entitlements', () => ({ requireLicenceWrite: vi.fn(async () => null) }));
const saveUploadedFile = vi.fn(async () => 'f.pdf');
vi.mock('@/lib/file-storage', async () => {
    const actual = await vi.importActual<typeof import('@/lib/file-storage')>('@/lib/file-storage');
    return { ...actual, saveUploadedFile: (...a: unknown[]) => saveUploadedFile(...(a as [])) };
});

const denied = { allowed: false, retryAfterSeconds: 60 };
const allowed = { allowed: true, retryAfterSeconds: 1 };
beforeEach(() => { consumeRateLimit.mockReset(); queryMock.mockClear(); saveUploadedFile.mockClear(); });

function upload() {
    const form = new FormData();
    form.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'a.pdf', { type: 'application/pdf' }));
    return new Request('http://localhost/api/upload/tok', { method: 'POST', body: form, headers: { 'x-real-ip': '203.0.113.9' } });
}

describe('public upload link', () => {
    it('answers 429 and stores nothing once the link or the address is over its limit', async () => {
        consumeRateLimit.mockResolvedValue(denied);
        const { POST } = await import('@/app/api/upload/[token]/route');
        const res = await POST(upload(), { params: Promise.resolve({ token: 'tok' }) });
        expect(res.status).toBe(429);
        expect(saveUploadedFile).not.toHaveBeenCalled();
        expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO ocr_queue/.test(sql))).toBe(false);
    });

    it('accepts an upload within the limits', async () => {
        consumeRateLimit.mockResolvedValue(allowed);
        const { POST } = await import('@/app/api/upload/[token]/route');
        const res = await POST(upload(), { params: Promise.resolve({ token: 'tok' }) });
        expect(res.status).toBe(200);
        expect(consumeRateLimit).toHaveBeenCalledWith('upload-token', 'tok', expect.any(Number), expect.any(Number));
    });
});

describe('hosted registration', () => {
    it('answers 429 before creating a firm once the address is over its limit', async () => {
        consumeRateLimit.mockResolvedValue(denied);
        const { POST } = await import('@/app/api/auth/register/route');
        const res = await POST(new Request('http://localhost/api/auth/register', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' },
            body: JSON.stringify({ firm_name: 'F', admin_email: 'a@example.test', password: 'long-enough-1' }),
        }));
        expect(res.status).toBe(429);
        expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO firms/.test(sql))).toBe(false);
    });
});
