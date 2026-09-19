import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ query: queryMock }));

import { consumeRateLimit, rateLimitResponse, requestIp } from '../rate-limit';

describe('database rate limits', () => {
    beforeEach(() => queryMock.mockReset());

    it('uses an atomic upsert and hashes the subject before storage', async () => {
        queryMock.mockResolvedValue({ rows: [{ attempts: 6, window_started_at: new Date() }] });
        const result = await consumeRateLimit('login-email', 'Person@Example.pl', 5, 60_000);
        expect(result.allowed).toBe(false);
        const [sql, params] = queryMock.mock.calls[0];
        expect(sql).toContain('ON CONFLICT (scope, subject_hash) DO UPDATE');
        expect(params[1]).toMatch(/^[0-9a-f]{64}$/);
        expect(params[1]).not.toContain('person@example.pl');
        expect(rateLimitResponse(result).status).toBe(429);
    });

    it('uses only nginx-provided X-Real-IP, never a spoofable X-Forwarded-For entry', () => {
        const request = new Request('http://x', { headers: { 'x-real-ip': '192.0.2.4', 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } });
        expect(requestIp(request)).toBe('192.0.2.4');
        const spoofedOnly = new Request('http://x', { headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } });
        expect(requestIp(spoofedOnly)).toBe('unknown');
    });
});
