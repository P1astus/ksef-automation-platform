import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const WORKFLOWS_DIR = join(__dirname, '..', '..', '..', '..', 'workflows');

describe('D7: no hardcoded KSeF host remains in any workflow url field', () => {
    const workflowFiles = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));

    it('found the expected 7 workflow files after the obsolete workflow 08 removal', () => {
        // 07-document-collection.json was deleted 2026-09-13 (unauthenticated
        // webhook, nothing called it) - see CLAUDE.md's Known issues section.
        // 09-client-notifications.json added later - it calls the portal and
        // n8n's own webhook, never the KSeF API, so it doesn't affect the
        // other checks in this file.
        expect(workflowFiles.length).toBe(7);
    });

    it.each(workflowFiles)('%s has no hardcoded api(-test).ksef.mf.gov.pl in a "url" field', (file) => {
        const content = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
        const hardcoded = content.match(/"url":\s*"=?https:\/\/api[^"]*ksef\.mf\.gov\.pl[^"]*"/g) || [];
        expect(hardcoded).toEqual([]);
    });

    it('the 3 remaining files that call the KSeF API all reference $env.KSEF_API_BASE', () => {
        for (const file of ['02-ksef-authenticate.json', '03-health-check.json', '04-ksef-invoice-retrieval.json']) {
            const content = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
            expect(content).toContain('$env.KSEF_API_BASE');
        }
    });

    it('never points at production (api.ksef.mf.gov.pl without -test)', () => {
        for (const file of workflowFiles) {
            const content = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
            const prodUrls = content.match(/"url":\s*"[^"]*api\.ksef\.mf\.gov\.pl[^"]*"/g) || [];
            expect(prodUrls).toEqual([]);
        }
    });
});

describe('D7: ksef-client.ts sidecar port source check', () => {
    it('the default XADES_SIDECAR fallback string is :8090, not :8080', () => {
        const src = readFileSync(join(__dirname, '..', 'ksef-client.ts'), 'utf8');
        expect(src).toContain("'http://xades-sidecar:8090'");
        expect(src).not.toContain(':8080');
    });
});

// Tomcat's embedded HTTP parser 400s on any Host header containing an
// underscore - confirmed live against the running sidecar container
// (curl -H "Host: xades_sidecar:8090" -> 400, curl -H "Host:
// xades-sidecar:8090" -> 200). docker-compose.yml's service name is
// "xades-sidecar" (hyphen); container_name is "xades_sidecar" (underscore) -
// both resolve via DNS, but only the hyphenated one is safe to put in a URL
// that becomes a Host header. Every place that builds a sidecar URL - the
// portal's own default, docker-compose's explicit overrides for the portal
// and n8n services, and settings/ksef/route.ts's connection-test ping - must
// never regress to the underscored hostname (or, independently, the wrong
// port that route.ts was still hardcoding: 8080, not 8090).
describe('sidecar hostname must never contain an underscore (Tomcat 400s on it)', () => {
    it('ksef-client.ts', () => {
        const src = readFileSync(join(__dirname, '..', 'ksef-client.ts'), 'utf8');
        // The comment explaining the bug legitimately quotes the broken
        // "xades_sidecar" form for context - check the actual URL literal,
        // not the whole file, so this doesn't flag its own documentation.
        expect(src).toContain("'http://xades-sidecar:8090'");
        expect(src).not.toMatch(/['"`]http:\/\/xades_sidecar/);
    });

    it('settings/ksef/route.ts uses the shared XADES_SIDECAR constant, not its own literal', () => {
        const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'settings', 'ksef', 'route.ts'), 'utf8');
        expect(src).not.toMatch(/xades_sidecar/);
        expect(src).not.toMatch(/:8080/);
        expect(src).toContain('XADES_SIDECAR');
    });

    it('docker-compose.yml', () => {
        const src = readFileSync(join(__dirname, '..', '..', '..', '..', 'docker-compose.yml'), 'utf8');
        const sidecarUrlLines = src.match(/XADES_SIDECAR_URL=[^\s]+/g) || [];
        expect(sidecarUrlLines.length).toBeGreaterThan(0);
        for (const line of sidecarUrlLines) {
            expect(line).not.toMatch(/xades_sidecar/);
        }
    });

    it('portal/.env.example', () => {
        const src = readFileSync(join(__dirname, '..', '..', '..', '.env.example'), 'utf8');
        const sidecarUrlLines = src.match(/XADES_SIDECAR_URL=[^\s]+/g) || [];
        expect(sidecarUrlLines.length).toBeGreaterThan(0);
        for (const line of sidecarUrlLines) {
            expect(line).not.toMatch(/xades_sidecar/);
        }
    });
});
