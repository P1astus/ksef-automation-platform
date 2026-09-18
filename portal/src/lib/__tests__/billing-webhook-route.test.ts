import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    constructEvent: vi.fn(),
    query: vi.fn(),
    invalidate: vi.fn(),
}));

vi.mock('stripe', () => ({
    default: class StripeMock {
        webhooks = { constructEvent: mocks.constructEvent };
    },
}));
vi.mock('@/lib/db', () => ({ query: mocks.query }));
vi.mock('@/lib/auth', () => ({ invalidateFirmActiveCache: mocks.invalidate }));

import { POST } from '@/app/api/billing/webhook/route';

function request() {
    return new Request('http://localhost/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'valid' },
        body: '{}',
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_START = 'price_start';
    process.env.STRIPE_PRICE_BIZNES = 'price_biznes';
    process.env.STRIPE_PRICE_PRO = 'price_pro';
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 7 }] });
});

describe('customer.subscription.updated webhook', () => {
    it('atomically updates tier, status and client cap from the actual Stripe price', async () => {
        mocks.constructEvent.mockReturnValue({
            type: 'customer.subscription.updated',
            data: { object: { id: 'sub_123', status: 'active', items: { data: [{ price: { id: 'price_pro' } }] } } },
        });

        const response = await POST(request());

        expect(response.status).toBe(200);
        expect(mocks.query).toHaveBeenCalledTimes(1);
        const [sql, params] = mocks.query.mock.calls[0];
        expect(sql).toMatch(/subscription_tier = \$1/);
        expect(sql).toMatch(/subscription_status = \$2/);
        expect(sql).toMatch(/max_clients = \$3/);
        expect(params).toEqual(['pro', 'active', 999, 'sub_123']);
        expect(mocks.invalidate).toHaveBeenCalledOnce();
    });

    it('fails for an unknown price instead of leaving stale entitlements', async () => {
        mocks.constructEvent.mockReturnValue({
            type: 'customer.subscription.updated',
            data: { object: { id: 'sub_123', status: 'active', items: { data: [{ price: { id: 'price_unknown' } }] } } },
        });

        const response = await POST(request());

        expect(response.status).toBe(500);
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.invalidate).not.toHaveBeenCalled();
    });
});
