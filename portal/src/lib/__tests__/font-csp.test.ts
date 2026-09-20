import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PORTAL = join(__dirname, '..', '..', '..');

describe('browser-origin egress controls', () => {
    it('loads both font styles only from self-hosted WOFF2 assets', () => {
        const layout = readFileSync(join(PORTAL, 'src/app/layout.tsx'), 'utf8');
        const fontCss = readFileSync(join(PORTAL, 'public/fonts/plus-jakarta-sans.css'), 'utf8');

        expect(layout).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
        expect(layout).toContain('/fonts/plus-jakarta-sans.css');
        for (const filename of [
            'plus-jakarta-sans-latin.woff2',
            'plus-jakarta-sans-latin-ext.woff2',
            'plus-jakarta-sans-latin-italic.woff2',
            'plus-jakarta-sans-latin-ext-italic.woff2',
        ]) {
            const fontPath = join(PORTAL, 'public/fonts', filename);
            expect(statSync(fontPath).size).toBeGreaterThan(10_000);
            expect(readFileSync(fontPath).subarray(0, 4).toString('ascii')).toBe('wOF2');
            expect(fontCss).toContain(filename);
        }
        expect(fontCss).toMatch(/font-style:\s*normal/);
        expect(fontCss).toMatch(/font-style:\s*italic/);
    });

    it('ships a CSP that confines browser network requests to this origin', async () => {
        const require = createRequire(import.meta.url);
        const config = require('../../../next.config.js');
        const rules = await config.headers();
        const csp = rules
            .flatMap((rule: { headers: { key: string; value: string }[] }) => rule.headers)
            .find((header: { key: string }) => header.key.toLowerCase() === 'content-security-policy')?.value;

        expect(csp).toBeTruthy();
        expect(csp).toMatch(/default-src 'self'/);
        expect(csp).toMatch(/connect-src 'self'/);
        expect(csp).toMatch(/font-src 'self'/);
        expect(csp).toMatch(/img-src 'self' data: blob:/);
        expect(csp).not.toMatch(/https?:|googleapis|gstatic/);
    });
});
