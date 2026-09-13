import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const WORKFLOWS_DIR = join(__dirname, '..', '..', '..', '..', 'workflows');

describe('D7: no hardcoded KSeF host remains in any workflow url field', () => {
    const workflowFiles = readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));

    it('found the expected 8 workflow files', () => {
        expect(workflowFiles.length).toBe(8);
    });

    it.each(workflowFiles)('%s has no hardcoded api(-test).ksef.mf.gov.pl in a "url" field', (file) => {
        const content = readFileSync(join(WORKFLOWS_DIR, file), 'utf8');
        const hardcoded = content.match(/"url":\s*"=?https:\/\/api[^"]*ksef\.mf\.gov\.pl[^"]*"/g) || [];
        expect(hardcoded).toEqual([]);
    });

    it('the 4 files that call the KSeF API all reference $env.KSEF_API_BASE', () => {
        for (const file of ['02-ksef-authenticate.json', '03-health-check.json', '04-ksef-invoice-retrieval.json', '08-ksef-submit-test-invoice.json']) {
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
        expect(src).toContain("'http://xades_sidecar:8090'");
        expect(src).not.toContain(':8080');
    });
});
