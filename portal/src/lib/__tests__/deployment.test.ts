import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveDeployment, capabilities, resetDeploymentCache, InvalidDeploymentError } from '../deployment';
import { requireCapability } from '../capability-guard';

describe('resolveDeployment: the default is the hosted SaaS, byte-identical to before the seam', () => {
    // If this fails, 'unmetered' (billing off) could reach production. Everything else is secondary.
    it('an empty environment resolves to saas with Stripe access', () => {
        expect(resolveDeployment({})).toEqual({
            mode: 'saas',
            billingProvider: 'stripe',
            accessProvider: 'stripe',
            operatorConsole: true,
            openRegistration: true,
            publicUpload: true,
            scheduler: false,
            emailTransport: 'resend',
        });
    });

    it('still tolerates an empty STRIPE_SECRET_KEY (docker-compose passes it empty by default)', () => {
        expect(() => resolveDeployment({ STRIPE_SECRET_KEY: '' })).not.toThrow();
        expect(resolveDeployment({ DEPLOYMENT_MODE: '' }).accessProvider).toBe('stripe');
    });

    it('a saas deployment cannot select a non-Stripe access policy', () => {
        expect(() => resolveDeployment({ ACCESS_PROVIDER: 'unmetered' })).toThrow(InvalidDeploymentError);
        expect(() => resolveDeployment({ DEPLOYMENT_MODE: 'saas', ACCESS_PROVIDER: 'licence' })).toThrow(/only valid with DEPLOYMENT_MODE=local/);
        expect(resolveDeployment({ DEPLOYMENT_MODE: 'saas', ACCESS_PROVIDER: 'stripe' }).accessProvider).toBe('stripe');
    });
});

describe('resolveDeployment: the local edition', () => {
    it('defaults to an unmetered, closed-registration, no-console, SMTP install', () => {
        expect(resolveDeployment({ DEPLOYMENT_MODE: 'local' })).toEqual({
            mode: 'local',
            billingProvider: 'none',
            accessProvider: 'unmetered',
            operatorConsole: false,
            openRegistration: false,
            publicUpload: false,
            scheduler: false,
            emailTransport: 'smtp',
        });
    });

    it('a licence access policy (Phase 6) is selectable and also has no billing', () => {
        const c = resolveDeployment({ DEPLOYMENT_MODE: 'local', ACCESS_PROVIDER: 'licence' });
        expect(c.accessProvider).toBe('licence');
        expect(c.billingProvider).toBe('none');
    });

    it('refuses a Stripe key next to a non-Stripe access policy: two sources of truth for account status', () => {
        expect(() => resolveDeployment({ DEPLOYMENT_MODE: 'local', STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(/two sources of truth/);
        expect(() => resolveDeployment({ DEPLOYMENT_MODE: 'local', ACCESS_PROVIDER: 'licence', STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(InvalidDeploymentError);
        // An empty key (what compose passes by default) is fine.
        expect(() => resolveDeployment({ DEPLOYMENT_MODE: 'local', STRIPE_SECRET_KEY: '' })).not.toThrow();
    });

    it('public upload is opt-in locally (it needs inbound internet)', () => {
        expect(resolveDeployment({ DEPLOYMENT_MODE: 'local', PUBLIC_UPLOAD_ENABLED: 'true' }).publicUpload).toBe(true);
        expect(resolveDeployment({ DEPLOYMENT_MODE: 'local', PUBLIC_UPLOAD_ENABLED: 'yes' }).publicUpload).toBe(false);
    });
});

describe('resolveDeployment: validation fails loudly, never silently falls back', () => {
    it.each([
        [{ DEPLOYMENT_MODE: 'Local' }, /DEPLOYMENT_MODE/],
        [{ DEPLOYMENT_MODE: 'onprem' }, /DEPLOYMENT_MODE/],
        [{ DEPLOYMENT_MODE: 'local', ACCESS_PROVIDER: 'free' }, /ACCESS_PROVIDER/],
        [{ EMAIL_TRANSPORT: 'sendgrid' }, /EMAIL_TRANSPORT/],
    ])('%j', (env, pattern) => {
        expect(() => resolveDeployment(env)).toThrow(pattern);
    });

    it('EMAIL_TRANSPORT overrides the per-mode default', () => {
        expect(resolveDeployment({ EMAIL_TRANSPORT: 'none' }).emailTransport).toBe('none');
        expect(resolveDeployment({ DEPLOYMENT_MODE: 'local', EMAIL_TRANSPORT: 'resend' }).emailTransport).toBe('resend');
    });
});

describe('capabilities() and requireCapability()', () => {
    afterEach(() => {
        delete process.env.DEPLOYMENT_MODE;
        resetDeploymentCache();
    });

    it('is memoized until reset, and resolves lazily from process.env', () => {
        delete process.env.DEPLOYMENT_MODE;
        resetDeploymentCache();
        expect(capabilities().mode).toBe('saas');
        process.env.DEPLOYMENT_MODE = 'local';
        expect(capabilities().mode).toBe('saas'); // memoized
        resetDeploymentCache();
        expect(capabilities().mode).toBe('local');
    });

    it('answers 404 (not 403) for a disabled capability, so a customer box never learns a vendor console exists', async () => {
        process.env.DEPLOYMENT_MODE = 'local';
        resetDeploymentCache();
        const res = requireCapability('operatorConsole');
        expect(res?.status).toBe(404);
        expect(await res?.json()).toEqual({ error: 'Not found' });
        expect(requireCapability('scheduler')?.status).toBe(404);
    });

    it('lets the request through when the capability is on', () => {
        delete process.env.DEPLOYMENT_MODE;
        resetDeploymentCache();
        expect(requireCapability('operatorConsole')).toBeNull();
    });
});

describe('deployment.ts stays edge-safe', () => {
    it('imports neither pg nor next/server (lib/auth.ts imports it and auth.ts is reachable from middleware)', () => {
        const src = readFileSync(join(__dirname, '..', 'deployment.ts'), 'utf8');
        expect(src).not.toMatch(/from ['"](pg|next\/server|\.\/db|next\/[a-z]+)['"]/);
        expect(src).not.toMatch(/require\(/);
    });
});
