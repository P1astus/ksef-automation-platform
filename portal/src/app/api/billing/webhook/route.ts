import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { query } from '@/lib/db';
import { PLAN_MAX_CLIENTS } from '@/lib/plans';

// Constructed lazily (on first actual use), not at module load - see
// billing/route.ts for why.
let stripe: Stripe | null = null;
function getStripe(): Stripe {
    if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
    return stripe;
}

export async function POST(request: Request) {
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

                const maxClients = PLAN_MAX_CLIENTS[targetPlan] ?? 20;

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
                const firmId = sub.metadata?.firmId;
                if (!firmId) break;

                const status = sub.status === 'active' ? 'active' : sub.status === 'past_due' ? 'past_due' : 'canceled';
                await query(
                    'UPDATE firms SET subscription_status = $1 WHERE stripe_subscription_id = $2',
                    [status, sub.id]
                );
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
    } catch (err) {
        console.error('Webhook handler error:', err);
        return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}
