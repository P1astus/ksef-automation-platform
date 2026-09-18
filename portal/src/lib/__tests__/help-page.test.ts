import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HelpPage from '../../app/dashboard/help/page';
import { PLANS, PLAN_FEATURES } from '../plans';

describe('help page', () => {
    const html = renderToStaticMarkup(createElement(HelpPage));

    it('renders every FAQ section', () => {
        for (const title of ['Pierwsze kroki', 'Tryby offline i terminy', 'JPK_V7M', 'Plany i płatności']) {
            expect(html).toContain(title);
        }
    });

    it('names exactly the plans that have paid features (derived from plans.ts)', () => {
        const paid = PLANS.filter(p => PLAN_FEATURES[p.id].length > 0).map(p => p.name).join(' i ');
        expect(html).toContain(`Eksport wymaga planu ${paid}`);
    });

    it('states the 14-day trial the Terms promise', () => {
        expect(html).toContain('14 dni od rejestracji');
    });

    it('does not advertise features that do not exist', () => {
        for (const bad of ['SMS', 'JPK_FA', 'white-label', 'SLA']) expect(html).not.toContain(bad);
    });
});
