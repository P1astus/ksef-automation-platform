import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The local edition has no trial and no self-registration after first run.
// Onboarding must not promise "14 dni za darmo" there, and the login page must
// not link to a registration page that answers 404. Both pages read the edition
// at runtime through a force-dynamic server wrapper.
const SRC = join(__dirname, '..', '..');
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function propsOf(path: string) {
    const mod = await import(path);
    return (mod.default() as { props: Record<string, unknown> }).props;
}

describe.each([
    ['onboarding', '@/app/dashboard/onboarding/page', 'showTrial'],
    ['login', '@/app/login/page', 'showRegister'],
])('%s page', (_name, path, prop) => {
    it('offers the trial/registration in the hosted edition', async () => {
        vi.stubEnv('DEPLOYMENT_MODE', '');
        expect((await propsOf(path))[prop]).toBe(true);
    });

    it('hides it in the local edition', async () => {
        vi.stubEnv('DEPLOYMENT_MODE', 'local');
        vi.stubEnv('ACCESS_PROVIDER', 'unmetered');
        expect((await propsOf(path))[prop]).toBe(false);
    });
});

describe('client components gate the copy on those props', () => {
    it('onboarding only mentions the trial behind showTrial', () => {
        const client = readFileSync(join(SRC, 'app/dashboard/onboarding/OnboardingClient.tsx'), 'utf8');
        expect(client).toMatch(/showTrial\s*&&[\s\S]{0,200}14 dni za darmo/);
    });
    it('login only links to registration behind showRegister', () => {
        const client = readFileSync(join(SRC, 'app/login/LoginClient.tsx'), 'utf8');
        expect(client).toMatch(/showRegister\s*&&[\s\S]{0,300}href="\/register"/);
    });
    it('both wrappers are force-dynamic', () => {
        for (const p of ['app/dashboard/onboarding/page.tsx', 'app/login/page.tsx']) {
            expect(readFileSync(join(SRC, p), 'utf8'), p).toMatch(/export const dynamic = 'force-dynamic'/);
        }
    });
});
