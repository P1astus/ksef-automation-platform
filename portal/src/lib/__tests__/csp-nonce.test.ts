import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

// Pages get a per-request nonce Content-Security-Policy: inline scripts run
// only with that nonce, so an injected <script> is blocked by the browser.
// Next.js reads the nonce from the forwarded request CSP header and stamps it
// on its own scripts; our one inline script (the service-worker registration)
// takes it from `x-nonce`.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
process.env.JWT_SECRET = 'n'.repeat(64);

const scriptSrc = (csp: string) => csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src')) ?? '';

async function run(path: string) {
    const { middleware } = await import('@/middleware');
    return middleware(new NextRequest(`https://portal.example${path}`));
}

describe('middleware CSP', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('sends a nonce policy without unsafe-inline for scripts and forwards the same nonce to rendering', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        const res = await run('/terms');
        const csp = res.headers.get('content-security-policy') ?? '';
        const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc(csp))?.[1];
        expect(nonce).toBeTruthy();
        expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
        expect(scriptSrc(csp)).not.toContain("'unsafe-eval'");
        expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
        expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
        for (const directive of ["default-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
            expect(csp).toContain(directive);
        }
    });

    it("allows 'unsafe-eval' only outside production (Next.js dev refresh)", async () => {
        const { contentSecurityPolicy } = await import('../csp');
        expect(scriptSrc(contentSecurityPolicy('abc', true))).toContain("'unsafe-eval'");
        expect(scriptSrc(contentSecurityPolicy('abc', false))).not.toContain("'unsafe-eval'");
    });

    it('uses a fresh nonce for every request', async () => {
        const a = (await run('/terms')).headers.get('content-security-policy');
        const b = (await run('/terms')).headers.get('content-security-policy');
        expect(a).not.toBe(b);
    });

    it('keeps the login redirect for protected pages', async () => {
        const res = await run('/dashboard');
        expect([307, 308]).toContain(res.status);
        expect(res.headers.get('location')).toContain('/login');
    });
});

describe('static CSP in next.config.js', () => {
    it('no longer applies to pages (it would be enforced alongside the nonce policy and block Next.js scripts)', async () => {
        const require = createRequire(import.meta.url);
        const rules: { source: string; headers: { key: string; value: string }[] }[] = await require('../../../next.config.js').headers();
        const cspRules = rules.filter(r => r.headers.some(h => h.key.toLowerCase() === 'content-security-policy'));
        expect(cspRules.length).toBeGreaterThan(0);
        for (const rule of cspRules) expect(rule.source).toMatch(/^\/api\//);
        for (const rule of cspRules) {
            const csp = rule.headers.find(h => h.key.toLowerCase() === 'content-security-policy')!.value;
            expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
        }
    });
});

describe('root layout', () => {
    it('gives its inline script the request nonce', () => {
        const layout = readFileSync(join(__dirname, '../../app/layout.tsx'), 'utf8');
        expect(layout).toMatch(/headers\(\)[\s\S]*get\('x-nonce'\)/);
        expect(layout).toMatch(/<script\s+nonce=\{nonce\}/);
    });
});
