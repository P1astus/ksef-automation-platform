import { NextResponse } from 'next/server';
import { appUrl } from '@/lib/app-url';
import Stripe from 'stripe';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { PLAN_MAX_CLIENTS } from '@/lib/plans';

// Constructed lazily (on first actual use), not at module load: `next build`
// statically imports every route module to collect page data, with no
// STRIPE_SECRET_KEY available at build time - `new Stripe(undefined)` threw
// and broke `docker build` itself.
let stripe: Stripe | null = null;
function getStripe(): Stripe {
    if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-02-25.clover' });
    return stripe;
}

// Exported so it can be checked against src/lib/plans.ts's PLANS (the UI
// literal) in a test — this is the price Stripe checkout actually charges,
// so a drift between the two is a real bug, not a cosmetic one.
export const PLAN_DETAILS = {
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
        // firms.max_clients is NOT NULL DEFAULT 15 — this fallback only
        // matters if `row` itself is missing, which shouldn't happen for an
        // authenticated session. Round 11 fix: it used to be a bare `20`,
        // the same wrong-plan-cap number round 8 fixed everywhere else.
        maxClients: row?.max_clients || PLAN_MAX_CLIENTS.start,
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
        // Changing the firm's subscription/payment is owner/admin territory,
        // not day-to-day work.
        const roleError = await requireRole(session, ['owner', 'admin']);
        if (roleError) return roleError;

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
            success_url: `${appUrl()}/dashboard/billing?success=1`,
            cancel_url: `${appUrl()}/dashboard/billing?cancelled=1`,
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
