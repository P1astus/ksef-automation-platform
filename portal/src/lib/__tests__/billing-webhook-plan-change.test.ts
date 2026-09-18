import { describe, expect, it } from 'vitest';
import { planFromSubscriptionPrices, subscriptionStatus } from '@/app/api/billing/webhook/route';

const prices = {
    start: 'price_start',
    biznes: 'price_biznes',
    pro: 'price_pro',
} as const;

describe('Stripe subscription plan changes', () => {
    it.each([
        ['price_start', 'start'],
        ['price_biznes', 'biznes'],
        ['price_pro', 'pro'],
    ] as const)('maps Stripe price %s to tier %s', (priceId, plan) => {
        expect(planFromSubscriptionPrices([priceId], prices)).toBe(plan);
    });

    it('ignores unrelated non-plan items when exactly one configured plan price is present', () => {
        expect(planFromSubscriptionPrices(['price_biznes', 'price_optional_addon'], prices)).toBe('biznes');
    });

    it('fails closed for an unknown price or multiple plan prices', () => {
        expect(() => planFromSubscriptionPrices(['price_unknown'], prices)).toThrow(/exactly one known plan price/);
        expect(() => planFromSubscriptionPrices(['price_start', 'price_pro'], prices)).toThrow(/exactly one known plan price/);
    });

    it('preserves the entitlement status vocabulary', () => {
        expect(subscriptionStatus('active')).toBe('active');
        expect(subscriptionStatus('trialing')).toBe('active');
        expect(subscriptionStatus('past_due')).toBe('past_due');
        expect(subscriptionStatus('paused')).toBe('paused');
        expect(subscriptionStatus('unpaid')).toBe('canceled');
    });
});
