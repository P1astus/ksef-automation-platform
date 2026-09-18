import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { appUrl } from '../app-url';

const SRC = join(__dirname, '..', '..');
const COMPOSE = join(SRC, '..', '..', 'docker-compose.yml');

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out); }
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
}

describe('portal env vars reach the container', () => {
    // NODE_ENV is set by the Dockerfile; OCR_UPLOAD_DIR and NEXT_PUBLIC_BASE_URL
    // are optional overrides with working defaults / a fallback in appUrl().
    const EXEMPT = new Set(['NODE_ENV', 'OCR_UPLOAD_DIR', 'NEXT_PUBLIC_BASE_URL']);

    it('docker-compose passes through every process.env.X the portal source reads', () => {
        const compose = readFileSync(COMPOSE, 'utf8');
        const portalBlock = compose.slice(compose.indexOf('  portal:'), compose.indexOf('  nginx:'));
        const used = new Set<string>();
        for (const f of walk(SRC)) {
            for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
        }
        const missing = [...used].filter(v => !EXEMPT.has(v) && !new RegExp(`[-"\\s]${v}=`).test(portalBlock));
        expect(missing).toEqual([]);
    });
});

describe('appUrl()', () => {
    const saved = { a: process.env.NEXT_PUBLIC_APP_URL, b: process.env.NEXT_PUBLIC_BASE_URL };
    afterEach(() => { process.env.NEXT_PUBLIC_APP_URL = saved.a; process.env.NEXT_PUBLIC_BASE_URL = saved.b; if (saved.a === undefined) delete process.env.NEXT_PUBLIC_APP_URL; if (saved.b === undefined) delete process.env.NEXT_PUBLIC_BASE_URL; });

    it('prefers APP_URL, falls back to BASE_URL, strips trailing slashes, is empty when unset', () => {
        delete process.env.NEXT_PUBLIC_APP_URL; delete process.env.NEXT_PUBLIC_BASE_URL;
        expect(appUrl()).toBe('');
        process.env.NEXT_PUBLIC_BASE_URL = 'https://b.example/';
        expect(appUrl()).toBe('https://b.example');
        process.env.NEXT_PUBLIC_APP_URL = 'https://a.example//';
        expect(appUrl()).toBe('https://a.example');
    });
});

describe('POST /api/auth/reset-password (request) in production', () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    beforeEach(() => { vi.resetModules(); queryMock.mockClear(); vi.doMock('@/lib/db', () => ({ query: queryMock })); });
    afterEach(() => { vi.unstubAllEnvs(); vi.doUnmock('@/lib/db'); });

    async function call() {
        const { POST } = await import('../../app/api/auth/reset-password/route');
        return POST(new Request('http://x/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ action: 'request', email: 'a@b.pl' }) }));
    }

    it('returns 503 instead of "link sent" when no mail provider is configured', async () => {
        vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('RESEND_API_KEY', ''); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.example');
        const res = await call();
        expect(res.status).toBe(503);
    });

    it('returns 503 when there is no public URL to put in the link', async () => {
        vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('RESEND_API_KEY', 'k'); vi.stubEnv('NEXT_PUBLIC_APP_URL', ''); vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
        const res = await call();
        expect(res.status).toBe(503);
    });
});
