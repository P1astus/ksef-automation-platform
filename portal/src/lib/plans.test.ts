import { describe, it, expect } from 'vitest';
import { PLANS } from './plans';
import { PLAN_DETAILS } from '@/app/api/billing/route';

// billing/page.tsx and PaywallOverlay.tsx both render PLANS from this file,
// so those two can no longer drift from each other. What they *could* still
// drift from is PLAN_DETAILS in billing/route.ts — the literal Stripe
// checkout actually charges against — since that's a separate object with a
// different shape (it also carries the Stripe price id). This test is the
// guard for that remaining seam.
describe('PLANS matches billing/route.ts PLAN_DETAILS (what Stripe actually charges)', () => {
    it('has the same price and client cap for every tier', () => {
        for (const plan of PLANS) {
            const details = PLAN_DETAILS[plan.id];
            expect(details, `no PLAN_DETAILS entry for "${plan.id}"`).toBeDefined();
            expect(plan.price, `${plan.id} price`).toBe(details.price);
            expect(plan.maxClients, `${plan.id} maxClients`).toBe(details.maxClients);
        }
    });

    it('covers exactly the same set of tiers', () => {
        expect(PLANS.map(p => p.id).sort()).toEqual(Object.keys(PLAN_DETAILS).sort());
    });
});
