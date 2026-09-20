// Server-side plan/subscription enforcement. The paywall overlay in
// dashboard/layout.tsx is UI only - anyone can call an API route directly - so
// every route that a plan or subscription state restricts must call one of the
// require* helpers below. The static plan matrix lives in plans.ts; this file
// is the database-aware part and must never be imported from a client
// component or from middleware (it pulls in `pg`).
import { NextResponse } from 'next/server';
import { query } from './db';
import { Feature, PlanId, cheapestPlanWith, planForTier, planHasFeature, PLANS } from './plans';
import { AccessProvider, capabilities } from './deployment';

export type AccessState = 'ok' | 'trial_expired' | 'canceled' | 'paused';

export interface FirmEntitlements {
    plan: PlanId | null;
    accessState: AccessState;
    has(feature: Feature): boolean;
}

interface FirmRow {
    subscription_tier?: unknown;
    subscription_status?: unknown;
    trial_expires_at?: Date | string | null;
}

// `past_due` (a failed Stripe charge that Stripe is still retrying) keeps
// access: cutting a firm off on the first failed card charge, mid-deadline,
// would be worse than a few days of grace. When Stripe gives up it sends
// `canceled`, which does block. Revisit if that grace needs a hard limit.
//
// `policy` is the ACCESS policy (lib/deployment.ts) - who decides whether the account is active:
//   'stripe' / 'licence'  the subscription columns (a licence writes the same columns Stripe's webhook does)
//   'unmetered'           a local install with no commercial lifecycle: trial/canceled/paused do not apply
// It is an explicit parameter, not a hidden env read, so this function stays pure. It controls ACTIVITY only.
// The plan TIER still decides which features the account has, in every policy: a local firm is simply created
// as an active Pro firm, so no tier check anywhere (including auth.ts) is bypassed or disagrees with a route.
// A missing row is `canceled` under every policy - that is null-safety, not a billing state.
export function evaluateEntitlements(
    row: FirmRow | undefined,
    now: Date = new Date(),
    policy: AccessProvider = 'stripe'
): FirmEntitlements {
    const plan = row ? planForTier(row.subscription_tier) : null;
    const status = row?.subscription_status ?? 'trial';

    let accessState: AccessState = 'ok';
    if (!row) accessState = 'canceled';
    else if (policy === 'unmetered') accessState = 'ok';
    else if (status === 'canceled') accessState = 'canceled';
    else if (status === 'paused') accessState = 'paused';
    else if (status === 'trial' && row.trial_expires_at && new Date(row.trial_expires_at) <= now) {
        accessState = 'trial_expired';
    }

    return {
        plan,
        accessState,
        // A trial gets the features of the plan the firm signed up for.
        has: (feature) => accessState === 'ok' && plan !== null && planHasFeature(plan, feature),
    };
}

export async function loadEntitlements(firmId: number): Promise<FirmEntitlements> {
    const res = await query(
        'SELECT subscription_tier, subscription_status, trial_expires_at FROM firms WHERE id = $1',
        [firmId]
    );
    return evaluateEntitlements(res.rows[0], new Date(), capabilities().accessProvider);
}

export function subscriptionInactiveResponse(state: AccessState) {
    return NextResponse.json(
        { error: 'Subskrypcja jest nieaktywna. Wybierz plan w zakładce Płatności.', code: 'SUBSCRIPTION_INACTIVE', state },
        { status: 402 }
    );
}

export function upgradeRequiredResponse(feature: Feature) {
    const requiredPlan = cheapestPlanWith(feature);
    const name = PLANS.find(p => p.id === requiredPlan)?.name ?? requiredPlan;
    return NextResponse.json(
        { error: `Ta funkcja wymaga planu ${name} lub wyższego.`, code: 'PLAN_UPGRADE_REQUIRED', feature, requiredPlan },
        { status: 403 }
    );
}

/** null = proceed; otherwise return the response from the route. */
export async function requireActiveSubscription(firmId: number): Promise<NextResponse | null> {
    const ent = await loadEntitlements(firmId);
    return ent.accessState === 'ok' ? null : subscriptionInactiveResponse(ent.accessState);
}

/** Subscription must be active AND the plan must include `feature`. */
export async function requireFeature(firmId: number, feature: Feature): Promise<NextResponse | null> {
    const ent = await loadEntitlements(firmId);
    if (ent.accessState !== 'ok') return subscriptionInactiveResponse(ent.accessState);
    if (!ent.has(feature)) return upgradeRequiredResponse(feature);
    return null;
}
