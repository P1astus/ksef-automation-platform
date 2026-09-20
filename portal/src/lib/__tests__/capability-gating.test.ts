import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { resetDeploymentCache } from '../deployment';

// Capability gating: the vendor console and billing exist only in the hosted edition. A local install answers 404
// (never 403, never a redirect to a login) so a customer's own box does not reveal them, and the hosted edition is
// untouched.

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => ({ rows: [] })), default: {} }));
vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(async () => null),
    requireRole: vi.fn(async () => null),
    MissingJwtSecretError: class extends Error {},
}));
vi.mock('@/lib/operator-auth', () => ({
    verifyOperatorLogin: vi.fn(),
    setOperatorCookie: vi.fn(),
    auditOperator: vi.fn(),
    clearOperatorCookie: vi.fn(),
    getOperatorSession: vi.fn(async () => null),
}));

import { POST as adminLogin } from '@/app/api/admin/login/route';
import { POST as adminLogout } from '@/app/api/admin/logout/route';
import { GET as billingGet, POST as billingPost } from '@/app/api/billing/route';
import { POST as stripeWebhook } from '@/app/api/billing/webhook/route';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

const post = (body: unknown = {}) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('source guards: no route or layout can quietly skip its gate', () => {
    it('every route under api/admin calls requireCapability("operatorConsole") before anything else', () => {
        const files = walk(join(SRC, 'app', 'api', 'admin')).filter(f => f.endsWith('route.ts'));
        expect(files.length).toBeGreaterThanOrEqual(2);
        for (const f of files) expect(readFileSync(f, 'utf8'), f).toMatch(/requireCapability\('operatorConsole'\)/);
    });

    it('every route under api/billing calls requireBilling() in each exported handler', () => {
        const files = walk(join(SRC, 'app', 'api', 'billing')).filter(f => f.endsWith('route.ts'));
        expect(files.length).toBeGreaterThanOrEqual(2);
        for (const f of files) {
            const src = readFileSync(f, 'utf8');
            const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)?.length ?? 0;
            const guards = src.match(/requireBilling\(\)/g)?.length ?? 0;
            expect(guards, f).toBe(handlers);
        }
    });

    it('the gate layouts read RUNTIME env, so they must be force-dynamic (else Next bakes the hosted value into the build)', () => {
        for (const rel of ['app/admin/layout.tsx', 'app/dashboard/billing/layout.tsx', 'app/page.tsx']) {
            expect(read(rel), rel).toMatch(/export const dynamic = 'force-dynamic'/);
        }
    });

    it('the gate layouts call notFound() and the console still guards every page itself', () => {
        expect(read('app/admin/layout.tsx')).toMatch(/notFound\(\)/);
        expect(read('app/dashboard/billing/layout.tsx')).toMatch(/notFound\(\)/);
        expect(read('lib/operator-auth.ts')).toMatch(/if \(!capabilities\(\)\.operatorConsole\) notFound\(\)/);
    });

    it('the dashboard hides the paywall, trial banner and billing link where Stripe is not the billing provider', () => {
        const layout = read('app/dashboard/layout.tsx');
        expect(layout).toMatch(/billingProvider === 'stripe'/);
        expect(layout).toMatch(/showPaywall = billing &&/);
        expect(layout).toMatch(/\{billing && <TrialBanner/);
        expect(layout).toMatch(/billing \|\| item\.href !== '\/dashboard\/billing'/);
    });
});

describe('local edition: 404 everywhere the hosted-only surfaces live', () => {
    beforeEach(() => { process.env.DEPLOYMENT_MODE = 'local'; resetDeploymentCache(); });
    afterEach(() => { delete process.env.DEPLOYMENT_MODE; resetDeploymentCache(); });

    it.each([
        ['POST /api/admin/login', () => adminLogin(post({ email: 'a@b.c', password: 'x' }))],
        ['POST /api/admin/logout', () => adminLogout()],
        ['GET /api/billing', () => billingGet()],
        ['POST /api/billing', () => billingPost(post({ plan: 'pro' }))],
        ['POST /api/billing/webhook', () => stripeWebhook(post())],
    ])('%s -> 404', async (_name, call) => {
        const res = await call();
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not found' });
    });
});

describe('hosted edition (default): the gates let everything through, behaviour unchanged', () => {
    beforeEach(() => { delete process.env.DEPLOYMENT_MODE; resetDeploymentCache(); });

    it('admin login reaches its own validation (400, not 404)', async () => {
        expect((await adminLogin(post({}))).status).toBe(400);
    });
    it('billing reaches its own auth check (401, not 404)', async () => {
        expect((await billingGet()).status).toBe(401);
    });
    it('the Stripe webhook reaches its own signature check (not 404)', async () => {
        expect((await stripeWebhook(post())).status).not.toBe(404);
    });
});
