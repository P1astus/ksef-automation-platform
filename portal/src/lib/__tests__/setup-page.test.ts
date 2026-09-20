import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PORTAL = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(PORTAL, path), 'utf8');

describe('local first-run UI', () => {
    it('posts the setup token and account fields to the existing registration endpoint', () => {
        const form = read('src/app/setup/SetupForm.tsx');
        expect(form).toContain("fetch('/api/auth/register'");
        for (const field of ['setup_token', 'firm_name', 'admin_email', 'password']) expect(form).toContain(field);
    });

    it('is runtime-only, local-only, and disappears once any firm exists', () => {
        const page = read('src/app/setup/page.tsx');
        expect(page).toContain("export const dynamic = 'force-dynamic'");
        expect(page).toContain("capabilities().mode !== 'local'");
        expect(page).toMatch(/SELECT COUNT\(\*\).*FROM firms/i);
        expect(page.match(/notFound\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('redirects only local /register traffic to /setup', () => {
        const middleware = read('src/middleware.ts');
        expect(middleware).toContain("pathname === '/register'");
        expect(middleware).toContain("capabilities().mode === 'local'");
        expect(middleware).toContain("new URL('/setup', request.url)");
    });
});

describe('runtime deployment capabilities', () => {
    it('never statically bakes a page or layout that reads capabilities()', () => {
        const app = join(PORTAL, 'src/app');
        const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const path = join(dir, entry.name);
            return entry.isDirectory() ? visit(path) : [path];
        });
        const readers = visit(app).filter(path => /(?:page|layout)\.tsx$/.test(path) && readFileSync(path, 'utf8').includes('capabilities()'));
        expect(readers.length).toBeGreaterThan(0);
        for (const path of readers) {
            expect(readFileSync(path, 'utf8'), path).toContain("export const dynamic = 'force-dynamic'");
        }
    });
});
