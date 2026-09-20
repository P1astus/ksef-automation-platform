import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Phase 0 packaging guards. The portal image is built from the repository ROOT so it can carry db/ and the
// migration runner; that widens the build context, which is only safe because the root .dockerignore is a
// whitelist. And the schema must come from the migration runner, never from initdb scripts.
const REPO = join(__dirname, '..', '..', '..', '..');
const read = (f: string) => readFileSync(join(REPO, f), 'utf8');
const lines = (f: string) => read(f).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));

describe('root .dockerignore is a whitelist', () => {
    const rules = lines('.dockerignore');

    it('excludes everything first, then re-includes only portal/ and db/', () => {
        expect(rules[0]).toBe('*');
        const included = rules.filter(r => r.startsWith('!') && !r.includes('/'));
        expect(included.sort()).toEqual(['!db', '!portal']);
    });

    it('cannot let certificates, env files, backups or key material into the build context', () => {
        for (const secret of ['certificates', 'backups', 'tmp', '.mcp.json', 'CLAUDE.md', 'HANDOVER.md']) {
            expect(rules).not.toContain(`!${secret}`);
        }
        for (const pattern of ['**/*.p12', '**/*.pem', '**/*.key', '**/.env']) expect(rules).toContain(pattern);
    });
});

describe('docker-compose applies the schema through the migration runner', () => {
    const compose = read('docker-compose.yml');

    it('no longer relies on docker-entrypoint-initdb.d (which only ran on an empty volume and missed `firms`)', () => {
        expect(compose).not.toContain('docker-entrypoint-initdb.d/');
        expect(compose).not.toMatch(/ksef-schema\.sql:\/docker-entrypoint/);
    });

    it('builds portal, ksef_migrate and ksef_worker from the repository root with the portal Dockerfile', () => {
        expect(compose).toMatch(/x-portal-build:\s*&portal-build\s+context: \.\s+dockerfile: portal\/Dockerfile/);
        expect(compose.match(/build: \*portal-build/g)?.length).toBe(3);
    });

    it('runs ksef_migrate as a one-shot and blocks the portal, n8n and the worker on its success', () => {
        expect(compose).toMatch(/ksef_migrate:[\s\S]*?restart: "no"[\s\S]*?command: \["node", "scripts\/migrate\.mjs"\]/);
        const conditions = compose.match(/ksef_migrate:\s+condition: service_completed_successfully/g) ?? [];
        expect(conditions.length).toBe(3); // portal, n8n and ksef_worker
    });

    it('never passes adoption confirmation by default (it must be an explicit, one-off decision)', () => {
        expect(compose).toContain('MIGRATIONS_CONFIRM_ADOPTION=${MIGRATIONS_CONFIRM_ADOPTION:-}');
    });
});

describe('portal Dockerfile', () => {
    const dockerfile = read('portal/Dockerfile');

    it('ships the runner and the schema, and only those', () => {
        expect(dockerfile).toMatch(/COPY --from=builder --chown=nextjs:nodejs \/app\/scripts \.\/scripts/);
        expect(dockerfile).toMatch(/COPY --chown=nextjs:nodejs db \.\/db/);
    });

    it('does not copy the archived historical SQL, certificates or env files into the image', () => {
        expect(dockerfile).not.toMatch(/COPY[^\n]*\bmigrations\b/);
        expect(dockerfile).not.toMatch(/COPY[^\n]*certificates/);
        expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    });
});

describe('the job worker is packaged inert and self-contained', () => {
    const compose = read('docker-compose.yml');
    const dockerfile = read('portal/Dockerfile');
    const worker = compose.slice(compose.indexOf('  ksef_worker:'), compose.indexOf('  # One-shot'));

    it('bundles worker.js with esbuild and ships it in the runtime image', () => {
        expect(dockerfile).toMatch(/npx esbuild src\/worker\/main\.ts --bundle --platform=node[^\r\n]*--outfile=worker\.js/);
        expect(dockerfile).toMatch(/COPY --from=builder --chown=nextjs:nodejs \/app\/worker\.js \.\/worker\.js/);
    });

    it('runs `node worker.js` with no job enabled by default (an unconfigured worker must be inert)', () => {
        expect(worker).toMatch(/command: \["node", "worker\.js"\]/);
        expect(worker).toContain('JOBS_ENABLED=${JOBS_ENABLED:-}');
        expect(worker).toContain('JOBS_SHADOW=${JOBS_SHADOW:-}');
    });

    it('runs in the Warsaw timezone and has no default alert recipient', () => {
        expect(worker).toContain('TZ=Europe/Warsaw');
        expect(worker).toContain('ALERT_EMAIL=${ALERT_EMAIL:-}');
        expect(compose).not.toMatch(/ALERT_EMAIL=[^$\s"]/); // never a hardcoded address
    });
});
