import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PLANS, PLAN_MAX_CLIENTS } from '../plans';

// Round 8: auth/register/route.ts and billing/webhook/route.ts each
// hardcoded their own copy of the per-tier client cap (both said
// start:20/biznes:60/pro:999) that had silently drifted from what's actually
// marketed on the pricing page and charged via Stripe checkout (PLANS /
// billing/route.ts's PLAN_DETAILS, both start:15/biznes:50/pro:999, and
// guarded against each other by plans.test.ts). A firm registering for
// "Start" got a 20-client cap instead of the 15 it was sold; completing a
// real Stripe subscription for "Biznes" would have set 60 instead of 50.
// Fixed by deriving both from PLAN_MAX_CLIENTS (itself derived from PLANS)
// instead of a second literal - this test guards against either call site
// reintroducing its own copy.
describe('PLAN_MAX_CLIENTS matches PLANS (round 8 drift fix)', () => {
    it('has the same maxClients as PLANS for every tier', () => {
        for (const plan of PLANS) {
            expect(PLAN_MAX_CLIENTS[plan.id], `${plan.id} maxClients`).toBe(plan.maxClients);
        }
    });

    it('auth/register/route.ts imports PLAN_MAX_CLIENTS, not its own literal', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'auth', 'register', 'route.ts'), 'utf8');
        expect(src).toContain("PLAN_MAX_CLIENTS");
        expect(src).toContain("from '@/lib/plans'");
        expect(src).not.toMatch(/PLAN_LIMITS/);
    });

    it('billing/webhook/route.ts imports PLAN_MAX_CLIENTS, not its own literal', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'billing', 'webhook', 'route.ts'), 'utf8');
        expect(src).toContain("PLAN_MAX_CLIENTS");
        expect(src).toContain("from '@/lib/plans'");
        expect(src).not.toMatch(/PLAN_LIMITS/);
    });
});
