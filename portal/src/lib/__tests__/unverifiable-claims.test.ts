import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

// Round 19: claims we cannot back up were removed by user decision (contractual SLA, invoice volume,
// data-residency). Don't re-add them without a real basis / legal review.
const read = (p: string) => readFileSync(join(__dirname, '../../app', p), 'utf8');

describe('unverifiable claims stay removed', () => {
    it('terms contain no contractual availability guarantee', () => {
        const t = read('terms/page.tsx');
        expect(t).not.toMatch(/99[.,]5/);
        expect(t).not.toMatch(/SLA/);
    });
    it('landing page makes no invoice-volume or server-location claim', () => {
        const l = read('page.tsx');
        expect(l).not.toMatch(/10 000\+/);
        expect(l).not.toMatch(/[Ss]erwer\w* w Polsce/);
    });
});
