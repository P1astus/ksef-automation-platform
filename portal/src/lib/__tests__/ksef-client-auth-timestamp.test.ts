import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The sidecar's EncryptionService.encryptForSession() does Instant.parse(timestamp) - it wants the ISO-8601 `timestamp`
// from KSeF's challenge response (what n8n's workflow 02 always sent) and derives the epoch milliseconds itself. The portal
// sent String(timestampMs) - "1789922108277" - so the sidecar answered 500 "Text '1789922108277' could not be parsed", which
// means EVERY portal-originated KSeF authentication (send, test, UPO fallback, invoice retrieval) failed. Found by running
// the invoice-retrieval job against a real sidecar; every earlier unit test mocked the sidecar away.

const ISO = '2026-09-21T10:00:00.123+00:00';
const MS = Date.parse(ISO);

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.resetModules(); vi.stubEnv('SIDECAR_API_KEY', 'k'); });

describe('initInteractiveSession -> sidecar /encrypt-for-session', () => {
    it('sends the challenge\'s ISO timestamp (parseable by Instant.parse), not the epoch-millisecond string', async () => {
        let sidecarBody: any;
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('/security/public-key-certificates')) return Response.json([{ certificate: 'CERT', usage: ['KsefTokenEncryption'] }]);
            if (url.endsWith('/auth/challenge')) return Response.json({ challenge: 'CH', timestamp: ISO, timestampMs: MS });
            if (url.endsWith('/encrypt-for-session')) { sidecarBody = JSON.parse(String(init?.body)); return Response.json({ success: true, encryptedToken: 'ENC' }); }
            if (url.endsWith('/auth/ksef-token')) return new Response('stop here', { status: 400 });
            throw new Error(`unexpected ${url}`);
        }));
        const { initInteractiveSession } = await import('../ksef-client');
        await expect(initInteractiveSession('1111111111', 'tok')).rejects.toThrow(/auth\/ksef-token failed/);
        expect(sidecarBody.timestamp).toBe(ISO);
        expect(sidecarBody.timestamp).not.toMatch(/^\d+$/);
        expect(new Date(sidecarBody.timestamp).getTime()).toBe(MS);   // same instant the sidecar will derive its epoch ms from
    });
});

describe('the contract both sides depend on', () => {
    it('the sidecar still parses an ISO instant (if this changes, the portal callers must change with it)', () => {
        const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'xades-sidecar', 'src', 'main', 'java', 'pl', 'ksef', 'sidecar', 'service', 'EncryptionService.java'), 'utf8');
        expect(src).toContain('Instant.parse(timestamp)');
    });

    it('ksef/test/route.ts does not send epoch milliseconds either', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'ksef', 'test', 'route.ts'), 'utf8');
        expect(src).not.toContain('String(ch.timestampMs)');
    });
});
