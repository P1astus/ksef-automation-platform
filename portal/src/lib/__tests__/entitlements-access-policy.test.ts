import { describe, it, expect, vi, afterEach } from 'vitest';

// The access policy decides whether the account is ACTIVE; the plan tier still decides which FEATURES it has.
// Both halves matter: bypassing only one makes authentication and route authorization disagree.

const queryMock = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => queryMock(...a) }));

import { evaluateEntitlements, loadEntitlements, requireFeature, requireActiveSubscription } from '../entitlements';
import { resetDeploymentCache } from '../deployment';
import type { Feature } from '../plans';

const FEATURES: Feature[] = ['exports', 'ai_classification', 'team', 'invoice_issuance'];
const past = new Date(Date.now() - 86400000);
const future = new Date(Date.now() + 5 * 86400000);
const now = new Date();

const expiredTrialPro = { subscription_tier: 'pro', subscription_status: 'trial', trial_expires_at: past };
const canceledPro = { subscription_tier: 'pro', subscription_status: 'canceled', trial_expires_at: null };
const pausedPro = { subscription_tier: 'pro', subscription_status: 'paused', trial_expires_at: null };

describe("access policy 'stripe' (the default) is exactly the pre-existing behaviour", () => {
    it.each([
        ['expired trial', expiredTrialPro, 'trial_expired'],
        ['canceled', canceledPro, 'canceled'],
        ['paused', pausedPro, 'paused'],
        ['live trial', { subscription_tier: 'pro', subscription_status: 'trial', trial_expires_at: future }, 'ok'],
        ['past_due keeps a grace period', { subscription_tier: 'pro', subscription_status: 'past_due' }, 'ok'],
    ])('%s', (_n, row, expected) => {
        expect(evaluateEntitlements(row, now).accessState).toBe(expected);
        expect(evaluateEntitlements(row, now, 'stripe').accessState).toBe(expected);
    });
});

describe("access policy 'unmetered' (local install with no commercial lifecycle)", () => {
    it.each([
        ['expired trial', expiredTrialPro],
        ['canceled', canceledPro],
        ['paused', pausedPro],
    ])('an %s row is still active', (_n, row) => {
        const ent = evaluateEntitlements(row, now, 'unmetered');
        expect(ent.accessState).toBe('ok');
        for (const f of FEATURES) expect(ent.has(f), f).toBe(true);
    });

    it('a missing firm row is still canceled: null-safety, not a billing state', () => {
        for (const policy of ['stripe', 'licence', 'unmetered'] as const) {
            expect(evaluateEntitlements(undefined, now, policy).accessState, policy).toBe('canceled');
            expect(evaluateEntitlements(undefined, now, policy).has('exports'), policy).toBe(false);
        }
    });

    it('does NOT bypass the tier: a Start-tier firm is active but still has no paid features', () => {
        const start = { subscription_tier: 'start', subscription_status: 'active', trial_expires_at: null };
        const ent = evaluateEntitlements(start, now, 'unmetered');
        expect(ent.accessState).toBe('ok');
        for (const f of FEATURES) expect(ent.has(f), f).toBe(false);
    });

    it('an unknown tier still fails closed', () => {
        const ent = evaluateEntitlements({ subscription_tier: 'gold', subscription_status: 'active' }, now, 'unmetered');
        expect(ent.plan).toBeNull();
        expect(ent.has('team')).toBe(false);
    });
});

describe("access policy 'licence' reads the same subscription columns a licence writes", () => {
    it('behaves like stripe today: an expired licence (written as canceled) blocks', () => {
        expect(evaluateEntitlements(canceledPro, now, 'licence').accessState).toBe('canceled');
        expect(evaluateEntitlements(expiredTrialPro, now, 'licence').accessState).toBe('trial_expired');
        expect(evaluateEntitlements({ subscription_tier: 'pro', subscription_status: 'active' }, now, 'licence').accessState).toBe('ok');
    });
});

describe('loadEntitlements / require* take the policy from the deployment', () => {
    afterEach(() => {
        delete process.env.DEPLOYMENT_MODE;
        resetDeploymentCache();
        queryMock.mockReset();
    });

    it('hosted (default): an expired trial is blocked with 402', async () => {
        queryMock.mockResolvedValue({ rows: [expiredTrialPro] });
        resetDeploymentCache();
        expect((await loadEntitlements(1)).accessState).toBe('trial_expired');
        const res = await requireActiveSubscription(1);
        expect(res?.status).toBe(402);
    });

    it('local (unmetered): the same expired-trial row passes every gate, and requireFeature still enforces the tier', async () => {
        process.env.DEPLOYMENT_MODE = 'local';
        resetDeploymentCache();

        queryMock.mockResolvedValue({ rows: [expiredTrialPro] });
        expect(await requireActiveSubscription(1)).toBeNull();
        expect(await requireFeature(1, 'invoice_issuance')).toBeNull();

        // Tier still decides features: a Start row is active but is refused a paid feature with 403.
        queryMock.mockResolvedValue({ rows: [{ subscription_tier: 'start', subscription_status: 'trial', trial_expires_at: past }] });
        expect(await requireActiveSubscription(1)).toBeNull();
        const denied = await requireFeature(1, 'team');
        expect(denied?.status).toBe(403);
        expect((await denied?.json()).code).toBe('PLAN_UPGRADE_REQUIRED');
    });
});
