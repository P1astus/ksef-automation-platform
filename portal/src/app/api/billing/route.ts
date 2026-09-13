import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

// Constructed lazily (on first actual use), not at module load: `next build`
// statically imports every route module to collect page data, with no
// STRIPE_SECRET_KEY available at build time - `new Stripe(undefined)` threw
// and broke `docker build` itself.
let stripe: Stripe | null = null;
function getStripe(): Stripe {
    if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
    return stripe;
}

const PLAN_DETAILS = {
    start:  { name: 'Start',  price: 149,  maxClients: 15,  tier: 'start',  priceId: process.env.STRIPE_PRICE_START! },
    biznes: { name: 'Biznes', price: 399,  maxClients: 50,  tier: 'biznes', priceId: process.env.STRIPE_PRICE_BIZNES! },
    pro:    { name: 'Pro',    price: 799,  maxClients: 999, tier: 'pro',    priceId: process.env.STRIPE_PRICE_PRO! },
} as const;

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const result = await query(
        `SELECT f.subscription_tier, f.max_clients, f.trial_expires_at, f.subscription_status,
                f.stripe_customer_id, f.stripe_subscription_id,
                COUNT(c.id)::int AS client_count
         FROM firms f
         LEFT JOIN clients c ON c.firm_id = f.id
         WHERE f.id = $1
         GROUP BY f.subscription_tier, f.max_clients, f.trial_expires_at, f.subscription_status,
                  f.stripe_customer_id, f.stripe_subscription_id`,
        [session.firmId]
    );

    const row = result.rows[0];
    const trialExpiresAt = row?.trial_expires_at ? new Date(row.trial_expires_at) : null;
    const daysLeft = trialExpiresAt
        ? Math.max(0, Math.ceil((trialExpiresAt.getTime() - Date.now()) / 86400000))
        : null;

    return NextResponse.json({
        tier: row?.subscription_tier || 'start',
        maxClients: row?.max_clients || 20,
        clientCount: row?.client_count || 0,
        status: row?.subscription_status || 'trial',
        trialDaysLeft: daysLeft,
        trialExpiresAt: row?.trial_expires_at,
        hasActiveSubscription: row?.subscription_status === 'active',
    });
}

export async function POST(request: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { targetPlan } = await request.json();
        const plan = PLAN_DETAILS[targetPlan as keyof typeof PLAN_DETAILS];

        if (!plan) {
            return NextResponse.json({ error: 'Nieprawidłowy plan' }, { status: 400 });
        }

        // Get firm data
        const firmResult = await query(
            'SELECT admin_email, firm_name, stripe_customer_id FROM firms WHERE id = $1',
            [session.firmId]
        );
        const firm = firmResult.rows[0];

        // Get or create Stripe customer
        let customerId = firm.stripe_customer_id;
        if (!customerId) {
            const customer = await getStripe().customers.create({
                email: firm.admin_email,
                name: firm.firm_name,
                metadata: { firmId: String(session.firmId) },
            });
            customerId = customer.id;
            await query('UPDATE firms SET stripe_customer_id = $1 WHERE id = $2', [customerId, session.firmId]);
        }

        // Create Stripe Checkout Session
        const checkoutSession = await getStripe().checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            payment_method_types: ['card', 'blik', 'p24'],
            line_items: [{ price: plan.priceId, quantity: 1 }],
            success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?success=1`,
            cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing?cancelled=1`,
            metadata: { firmId: String(session.firmId), targetPlan },
            subscription_data: {
                metadata: { firmId: String(session.firmId), targetPlan },
            },
            locale: 'pl',
        });

        return NextResponse.json({ url: checkoutSession.url });
    } catch (err: any) {
        console.error('Billing POST error:', err);
        return NextResponse.json({ error: err?.message || 'Błąd serwera' }, { status: 500 });
    }
}
