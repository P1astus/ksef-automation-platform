import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// nginx resolves a hostname in a static `upstream`/`proxy_pass` block once, at
// startup, and keeps that IP forever. Recreating the portal container (a normal
// `docker compose up -d --build`) gives it a new IP, and nginx then answers 502
// on every request until nginx itself is restarted. Both configs must resolve
// through Docker's embedded DNS at request time instead.
const read = (name: string) => readFileSync(join(__dirname, '../../../../nginx', name), 'utf8');

describe.each(['nginx.conf', 'nginx.local.conf'])('%s upstream resolution', (name) => {
    const conf = read(name);

    it('uses Docker DNS with a short TTL', () => {
        expect(conf).toMatch(/resolver 127\.0\.0\.11 valid=\d+s/);
    });

    it('has no statically resolved upstream block', () => {
        expect(conf).not.toMatch(/^\s*upstream\s+\w+\s*\{/m);
    });

    it('proxies only through variables, so each request re-resolves', () => {
        const targets = [...conf.matchAll(/proxy_pass\s+([^;]+);/g)].map(m => m[1].trim());
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) expect(target).toMatch(/^\$\w+$/);
    });
});
