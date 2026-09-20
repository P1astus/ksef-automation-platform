import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { query } from '@/lib/db';
import { PLAN_MAX_CLIENTS, type PlanId } from '@/lib/plans';
import { invalidateFirmActiveCache } from '@/lib/auth';
import { requireBilling } from '@/lib/capability-guard';

// Constructed lazily (on first actual use), not at module load - see
// billing/route.ts for why.
let stripe: Stripe | null = null;
function getStripe(): Stripe {
    if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
    return stripe;
}

type SubscriptionPriceMap = Record<PlanId, string | undefined>;

export function planFromSubscriptionPrices(
    priceIds: readonly string[],
    configuredPrices: SubscriptionPriceMap = {
        start: process.env.STRIPE_PRICE_START,
        biznes: process.env.STRIPE_PRICE_BIZNES,
        pro: process.env.STRIPE_PRICE_PRO,
    }
): PlanId {
    const matchedPlans = (Object.entries(configuredPrices) as [PlanId, string | undefined][])
        .filter(([, configuredId]) => configuredId && priceIds.includes(configuredId))
        .map(([plan]) => plan);

    if (matchedPlans.length !== 1) {
        throw new Error(`customer.subscription.updated: expected exactly one known plan price, matched ${matchedPlans.length}`);
    }
    return matchedPlans[0];
}

export function subscriptionStatus(status: Stripe.Subscription.Status): 'active' | 'past_due' | 'paused' | 'canceled' {
    if (status === 'active' || status === 'trialing') return 'active';
    if (status === 'past_due') return 'past_due';
    if (status === 'paused') return 'paused';
    return 'canceled';
}

export async function POST(request: Request) {
    const off = requireBilling();
    if (off) return off;
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 });

    let event: Stripe.Event;
    try {
        event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const firmId = session.metadata?.firmId;
                const targetPlan = session.metadata?.targetPlan;
                const subscriptionId = session.subscription as string;

                if (!firmId || !targetPlan) break;

                // Round 11 fix: this used to fall back to a bare `20` for an
                // unrecognized plan — the exact wrong number (marketed
                // `start` is 15) round 8 fixed everywhere else. A plan
                // that doesn't match a known PLAN_MAX_CLIENTS key (stale
                // client, future plan rename) should never silently
                // provision a client cap that wasn't sold; throwing here
                // surfaces as a failed webhook in Stripe's dashboard
                // (which retries) instead of a silent wrong grant.
                const maxClients = PLAN_MAX_CLIENTS[targetPlan];
                if (maxClients === undefined) {
                    throw new Error(`checkout.session.completed: unrecognized targetPlan "${targetPlan}" for firm ${firmId}`);
                }

                await query(
                    `UPDATE firms SET
                        subscription_tier = $1,
                        subscription_status = 'active',
                        max_clients = $2,
                        stripe_subscription_id = $3,
                        trial_expires_at = NULL
                     WHERE id = $4`,
                    [targetPlan, maxClients, subscriptionId, firmId]
                );
                break;
            }

            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                const targetPlan = planFromSubscriptionPrices(sub.items.data.map(item => item.price.id));
                const result = await query(
                    `UPDATE firms SET
                        subscription_tier = $1,
                        subscription_status = $2,
                        max_clients = $3
                     WHERE stripe_subscription_id = $4
                     RETURNING id`,
                    [targetPlan, subscriptionStatus(sub.status), PLAN_MAX_CLIENTS[targetPlan], sub.id]
                );
                if (result.rowCount !== 1) {
                    throw new Error(`customer.subscription.updated: no firm found for subscription "${sub.id}"`);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                await query(
                    `UPDATE firms SET subscription_status = 'canceled', stripe_subscription_id = NULL
                     WHERE stripe_subscription_id = $1`,
                    [sub.id]
                );
                break;
            }
        }
        // A tier change gates invited team members' existing sessions
        // (getSession() caches the tier per firm); drop the cache so a
        // downgrade takes effect now rather than after the TTL.
        invalidateFirmActiveCache();
    } catch (err) {
        console.error('Webhook handler error:', err);
        return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}
