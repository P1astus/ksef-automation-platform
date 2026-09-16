import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Round 8: auth/register/route.ts granted a 30-day trial while the actual
// Terms of Service (terms/page.tsx, "Okres próbny: 14 dni od rejestracji")
// and CLAUDE.md's own architecture description ("14-day trial") both commit
// to 14 - every signup got 16 extra free days nobody agreed to grant. Fixed
// to INTERVAL '14 days'. This test guards the registration route against
// drifting from the ToS's promised trial length again.
describe('trial length matches the Terms of Service (round 8)', () => {
    it("register/route.ts grants a 14-day trial, not 30", () => {
        const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'auth', 'register', 'route.ts'), 'utf8');
        expect(src).toContain("INTERVAL '14 days'");
        expect(src).not.toContain("INTERVAL '30 days'");
    });

    it("terms/page.tsx still promises 14 days (so this test would catch either side drifting)", () => {
        const src = readFileSync(join(__dirname, '..', '..', 'app', 'terms', 'page.tsx'), 'utf8');
        expect(src).toContain('14 dni od rejestracji');
    });
});
