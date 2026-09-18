// Single source of truth for the three subscription tiers, shared by every
// UI surface that shows or acts on them (dashboard/billing/page.tsx,
// dashboard/PaywallOverlay.tsx). Keep this in sync with billing/route.ts's
// PLAN_DETAILS (price/tier/maxClients — that's what Stripe checkout actually
// charges) and PricingSection.tsx (the public marketing page, which needs
// its own shape for the monthly/annual toggle and isn't a good fit to share
// this type, but should still quote the same monthly prices).
export type PlanId = 'start' | 'biznes' | 'pro';

// Paid capabilities a plan can grant. Start is deliberately a read-only
// monitoring/reporting plan (KSeF sync, JPK_V7M, e-mail alerts); everything
// that writes to KSeF, exports to accounting software, classifies with AI or
// adds team seats needs Biznes or Pro. `invoice_issuance` is ONE capability
// covering invoice creation, every offline mode and KSeF sending - splitting
// them would let a Start firm create an offline invoice (starting a statutory
// upload deadline) that it is then forbidden to send.
export type Feature = 'exports' | 'ai_classification' | 'team' | 'invoice_issuance';

export const PLAN_FEATURES: Record<PlanId, readonly Feature[]> = {
    start: [],
    biznes: ['exports', 'ai_classification', 'team', 'invoice_issuance'],
    pro: ['exports', 'ai_classification', 'team', 'invoice_issuance'],
};

const PLAN_ORDER: PlanId[] = ['start', 'biznes', 'pro'];

export function isPlanId(value: unknown): value is PlanId {
    return typeof value === 'string' && (PLAN_ORDER as string[]).includes(value);
}

// firms.subscription_tier's CHECK also allows 'enterprise', which has no entry
// in PLANS and is not sold; it gets Pro's features. Anything else unrecognised
// gets NO paid features (fail closed) rather than being guessed at.
export function planForTier(tier: unknown): PlanId | null {
    if (tier === 'enterprise') return 'pro';
    return isPlanId(tier) ? tier : null;
}

export function tierHasFeature(tier: unknown, feature: Feature): boolean {
    const plan = planForTier(tier);
    return plan !== null && planHasFeature(plan, feature);
}

export function planHasFeature(plan: PlanId, feature: Feature): boolean {
    return PLAN_FEATURES[plan].includes(feature);
}

/** Cheapest plan that includes `feature` - what an upgrade prompt should name. */
export function cheapestPlanWith(feature: Feature): PlanId {
    const found = PLAN_ORDER.find(id => planHasFeature(id, feature));
    if (!found) throw new Error(`No plan grants feature "${feature}"`);
    return found;
}

export interface Plan {
    id: PlanId;
    name: string;
    price: number;
    maxClients: number;
    highlight?: boolean;
    features: string[];
}

// Only list what is actually built and enforced. No SMS alerts, JPK_FA, public
// API, white-label, SLA or "real-time" sync: none exist (round 14 audit), and
// advertising them is misleading. Pro's client cap is really 999, so say 999.
export const PLANS: Plan[] = [
    {
        id: 'start',
        name: 'Start',
        price: 149,
        maxClients: 15,
        features: ['Do 15 klientów (NIP)', 'Plan tylko do odczytu i raportowania', 'Pobieranie faktur z KSeF', 'Generowanie JPK_V7M', 'Alerty e-mail', 'Wsparcie e-mail'],
    },
    {
        id: 'biznes',
        name: 'Biznes',
        price: 399,
        maxClients: 50,
        highlight: true,
        features: ['Do 50 klientów (NIP)', 'Wszystko z planu Start', 'Wystawianie faktur i wysyłka do KSeF (w tym tryby offline)', 'Eksport CSV / Optima / Symfonia', 'Klasyfikacja AI kosztów', 'Zarządzanie zespołem'],
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 799,
        maxClients: 999,
        features: ['Do 999 klientów (NIP)', 'Wszystkie funkcje Biznes'],
    },
];

// Plain id -> maxClients lookup for the two enforcement points that only
// need the client cap, not the full Plan shape: auth/register/route.ts (sets
// a new firm's initial cap) and billing/webhook/route.ts (sets it again on a
// real Stripe subscription). Both used to hardcode their own copy of these
// numbers (20/60/999) that had drifted from what's actually marketed and
// charged (15/50/999) - found round 8. Deriving from PLANS instead of a
// second literal is what makes that drift impossible now, not just less
// likely.
export const PLAN_MAX_CLIENTS: Record<string, number> = Object.fromEntries(
    PLANS.map(p => [p.id, p.maxClients])
);
