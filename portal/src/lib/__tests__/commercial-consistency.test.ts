import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PLANS } from '../plans';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

// Round 14: registration, terms, pricing and the landing page each carried
// their own (different) prices, caps, trial length and SLA. plans.ts is the
// source of truth; these guard the surfaces that can't import it.
describe('marketing/legal surfaces agree with plans.ts', () => {
    it('register page quotes the real price and cap of every plan', () => {
        const src = read('app/register/page.tsx');
        for (const p of PLANS) {
            expect(src).toContain(`${p.price} zł/mies.`);
            expect(src).toContain(`do ${p.maxClients} klientów`);
        }
    });
    it('terms quote the real price and cap of every plan', () => {
        const src = read('app/terms/page.tsx');
        for (const p of PLANS) expect(src).toContain(`${p.price} PLN/mies. — do ${p.maxClients} klientów`);
    });
    it('nobody promises a 30-day trial (real trial is 14 days)', () => {
        for (const f of ['app/page.tsx', 'app/register/page.tsx', 'app/PricingSection.tsx', 'app/demo/page.tsx',
            'app/dashboard/PaywallOverlay.tsx', 'app/dashboard/onboarding/page.tsx']) {
            expect(read(f), f).not.toMatch(/30[ -]dni|30-dniow/);
        }
    });
    it('no plan advertises features that do not exist', () => {
        const text = PLANS.flatMap(p => p.features).join(' | ') + read('app/PricingSection.tsx');
        for (const banned of [/SMS/i, /JPK_FA/, /white-label/i, /SLA/, /\bAPI do\b/i, /Nieograniczon/i, /czasie rzeczywistym/i]) {
            expect(text).not.toMatch(banned);
        }
        expect(read('app/page.tsx')).not.toContain('99.9%');
    });
});
