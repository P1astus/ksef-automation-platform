import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    requireRole: vi.fn(),
    query: vi.fn(),
    readFile: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession, requireRole: mocks.requireRole }));
vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('fs/promises', () => ({ readFile: mocks.readFile }));

import { GET } from './route';

describe('GET /api/ocr-queue/[id]/file', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getSession.mockResolvedValue({ firmId: 7, role: 'member' });
        mocks.requireRole.mockResolvedValue(null);
    });

    it('loads the row through firm_id and serves a private, nosniff PDF', async () => {
        mocks.query.mockResolvedValue({ rows: [{ file_path: '123e4567-e89b-12d3-a456-426614174000.pdf', file_type: 'pdf' }] });
        mocks.readFile.mockResolvedValue(Buffer.from('%PDF'));

        const response = await GET(new Request('http://x'), { params: Promise.resolve({ id: '42' }) });

        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('firm_id = $2'), ['42', 7]);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/pdf');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('does not reveal another firm\'s document', async () => {
        mocks.query.mockResolvedValue({ rows: [] });
        const response = await GET(new Request('http://x'), { params: Promise.resolve({ id: '42' }) });
        expect(response.status).toBe(404);
        expect(mocks.readFile).not.toHaveBeenCalled();
    });

    it('rejects a stored traversal path before reading the filesystem', async () => {
        mocks.query.mockResolvedValue({ rows: [{ file_path: '../secret', file_type: 'pdf' }] });
        const response = await GET(new Request('http://x'), { params: Promise.resolve({ id: '42' }) });
        expect(response.status).toBe(500);
        expect(mocks.readFile).not.toHaveBeenCalled();
    });
});
