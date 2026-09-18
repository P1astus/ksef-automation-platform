import { describe, it, expect } from 'vitest';
import { evaluateEntitlements } from '../entitlements';
import { PLANS, PLAN_FEATURES, cheapestPlanWith, tierHasFeature, type Feature } from '../plans';

const FEATURES: Feature[] = ['exports', 'ai_classification', 'team', 'invoice_issuance'];
const future = new Date(Date.now() + 5 * 86400000);
const past = new Date(Date.now() - 86400000);

describe('plan entitlement matrix', () => {
    it('Start is read-only: none of the four paid capabilities', () => {
        for (const f of FEATURES) expect(tierHasFeature('start', f), f).toBe(false);
    });
    it('Biznes and Pro have all four', () => {
        for (const t of ['biznes', 'pro'])
            for (const f of FEATURES) expect(tierHasFeature(t, f), `${t}/${f}`).toBe(true);
    });
    it('invoice creation, offline modes and sending are ONE capability', () => {
        expect(FEATURES.filter(f => f.startsWith('invoice'))).toEqual(['invoice_issuance']);
    });
    it('upgrade prompts name Biznes', () => {
        for (const f of FEATURES) expect(cheapestPlanWith(f)).toBe('biznes');
    });
    it('unknown tiers fail closed; enterprise gets Pro features', () => {
        expect(tierHasFeature('gold', 'team')).toBe(false);
        expect(tierHasFeature(undefined, 'exports')).toBe(false);
        expect(tierHasFeature('enterprise', 'team')).toBe(true);
    });
    it('every plan in PLANS has a matrix entry', () => {
        expect(PLANS.map(p => p.id).sort()).toEqual(Object.keys(PLAN_FEATURES).sort());
    });
});

describe('evaluateEntitlements (subscription state, enforced server-side)', () => {
    it('a live trial inherits the selected plan', () => {
        const start = evaluateEntitlements({ subscription_tier: 'start', subscription_status: 'trial', trial_expires_at: future });
        const biz = evaluateEntitlements({ subscription_tier: 'biznes', subscription_status: 'trial', trial_expires_at: future });
        expect(start.has('invoice_issuance')).toBe(false);
        expect(biz.has('invoice_issuance')).toBe(true);
    });
    it('an expired trial loses everything, even on Pro', () => {
        const e = evaluateEntitlements({ subscription_tier: 'pro', subscription_status: 'trial', trial_expires_at: past });
        expect(e.accessState).toBe('trial_expired');
        for (const f of FEATURES) expect(e.has(f)).toBe(false);
    });
    it('canceled and paused block; past_due keeps a grace period; active is fine', () => {
        const st = (s: string) => evaluateEntitlements({ subscription_tier: 'biznes', subscription_status: s, trial_expires_at: null }).accessState;
        expect(st('canceled')).toBe('canceled');
        expect(st('paused')).toBe('paused');
        expect(st('past_due')).toBe('ok');
        expect(st('active')).toBe('ok');
    });
    it('a missing firm row is denied', () => {
        expect(evaluateEntitlements(undefined).accessState).toBe('canceled');
    });
});
