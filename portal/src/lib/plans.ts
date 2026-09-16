// Single source of truth for the three subscription tiers, shared by every
// UI surface that shows or acts on them (dashboard/billing/page.tsx,
// dashboard/PaywallOverlay.tsx). Keep this in sync with billing/route.ts's
// PLAN_DETAILS (price/tier/maxClients — that's what Stripe checkout actually
// charges) and PricingSection.tsx (the public marketing page, which needs
// its own shape for the monthly/annual toggle and isn't a good fit to share
// this type, but should still quote the same monthly prices).
export interface Plan {
    id: 'start' | 'biznes' | 'pro';
    name: string;
    price: number;
    maxClients: number;
    highlight?: boolean;
    features: string[];
}

export const PLANS: Plan[] = [
    {
        id: 'start',
        name: 'Start',
        price: 149,
        maxClients: 15,
        features: ['Do 15 klientów (NIP)', 'Pobieranie faktur z KSeF', 'Generowanie JPK_V7M', 'Alerty e-mail', 'Wsparcie e-mail'],
    },
    {
        id: 'biznes',
        name: 'Biznes',
        price: 399,
        maxClients: 50,
        highlight: true,
        features: ['Do 50 klientów (NIP)', 'Pobieranie faktur w czasie rzeczywistym', 'JPK_V7M + JPK_FA', 'Alerty SMS + e-mail', 'Wysyłka faktur do KSeF', 'Eksport CSV / Optima / Symfonia', 'Klasyfikacja AI kosztów', 'Zarządzanie zespołem'],
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 799,
        maxClients: 999,
        features: ['Nieograniczona liczba klientów', 'Wszystkie funkcje Biznes', 'API do integracji z systemami FK', 'Dedykowany opiekun klienta', 'SLA 99.9% z gwarancją', 'White-label (własna domena)'],
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
