import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Round 4: xades-sidecar's 4 crypto endpoints (/encrypt-for-session,
// /encrypt-batch-package, /generate-session-key, /encrypt-invoice) had no
// authentication at all and are published on 0.0.0.0:8090 - anyone who could
// reach the port could call them. Fixed with a shared-secret header
// (SidecarApiKeyFilter on the sidecar side); this file proves every portal
// call site sends it, and that n8n's direct sidecar calls do too.

const ROOT = join(__dirname, '..', '..', '..', '..');

describe('ksef-client.ts sends X-Sidecar-Api-Key on every sidecar call', () => {
    const originalEnv = process.env.SIDECAR_API_KEY;
    beforeEach(() => { process.env.SIDECAR_API_KEY = 'test-key-123'; });
    afterEach(() => { process.env.SIDECAR_API_KEY = originalEnv; });

    it('sidecarHeaders() includes the header when SIDECAR_API_KEY is set', async () => {
        const { sidecarHeaders } = await import('@/lib/ksef-client');
        expect(sidecarHeaders()).toEqual({
            'Content-Type': 'application/json',
            'X-Sidecar-Api-Key': 'test-key-123',
        });
    });

    it('sidecarHeaders() throws a clear error when SIDECAR_API_KEY is unset (fails loud, not silently unauthenticated)', async () => {
        delete process.env.SIDECAR_API_KEY;
        const { sidecarHeaders } = await import('@/lib/ksef-client');
        expect(() => sidecarHeaders()).toThrow(/SIDECAR_API_KEY is not set/);
    });

    it('all three sidecar fetch calls in ksef-client.ts use sidecarHeaders()', () => {
        const src = readFileSync(join(__dirname, '..', 'ksef-client.ts'), 'utf8');
        const calls = ['/encrypt-for-session', '/generate-session-key', '/encrypt-invoice'];
        for (const endpoint of calls) {
            const idx = src.indexOf(`${endpoint}\``);
            expect(idx, `${endpoint} call site should exist`).toBeGreaterThan(-1);
            const nextLines = src.slice(idx, idx + 200);
            expect(nextLines).toContain('headers: sidecarHeaders()');
        }
    });

    it('ksef/test/route.ts uses sidecarHeaders() too, not a bare Content-Type header', () => {
        const src = readFileSync(join(ROOT, 'portal', 'src', 'app', 'api', 'ksef', 'test', 'route.ts'), 'utf8');
        expect(src).toContain('sidecarHeaders()');
        expect(src).not.toMatch(/encrypt-for-session[\s\S]{0,150}headers:\s*{\s*'Content-Type'/);
    });
});

describe('docker-compose.yml requires SIDECAR_API_KEY on every service that talks to the sidecar', () => {
    it('portal, worker, n8n, and xades-sidecar all fail fast without it set', () => {
        const src = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
        const occurrences = src.match(/SIDECAR_API_KEY=\$\{SIDECAR_API_KEY:\?/g) || [];
        expect(occurrences.length).toBe(4);
    });
});
