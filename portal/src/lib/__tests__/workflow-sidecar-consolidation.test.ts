import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Audit finding (round 3): three n8n Code nodes reimplemented the sidecar's
// RSA-OAEP-SHA256 encryption directly in Node's crypto module - a second,
// independent implementation of the same operation the sidecar already
// exposes over HTTP (/encrypt-for-session, /generate-session-key), which
// could silently drift from it. Consolidated onto the sidecar once its
// underlying reachability bug (the underscored Host header - see
// d7-env-plumbing.test.ts) was fixed, since calling it from n8n would have
// hit the exact same 400 before that fix landed.
//
// Proves each node no longer does the RSA-OAEP step locally, calls the
// correct sidecar endpoint, and that the JSON files are still valid and
// importable (can't validate live - no working n8n owner credentials exist
// in this environment, per HANDOVER.md, across every round).

const ROOT = join(__dirname, '..', '..', '..', '..');

function loadNode(file: string, nodeName: string) {
    const data = JSON.parse(readFileSync(join(ROOT, 'workflows', file), 'utf8'));
    const node = data.nodes.find((n: { name: string }) => n.name === nodeName);
    expect(node, `${nodeName} should exist in ${file}`).toBeTruthy();
    return node.parameters.jsCode as string;
}

describe('n8n RSA-OAEP nodes call the sidecar instead of duplicating crypto locally', () => {
    it('all 7 retained workflow files are still valid JSON', () => {
        for (const file of [
            '01-send-alert.json', '02-ksef-authenticate.json', '03-health-check.json',
            '04-ksef-invoice-retrieval.json', '05-offline24-monitor.json',
            '06-jpk-vat-preparation.json', '09-client-notifications.json',
        ]) {
            expect(() => JSON.parse(readFileSync(join(ROOT, 'workflows', file), 'utf8'))).not.toThrow();
        }
    });

    it('02: "Encrypt Token RSA-OAEP" calls /encrypt-for-session, no local crypto.publicEncrypt', () => {
        const code = loadNode('02-ksef-authenticate.json', 'Encrypt Token RSA-OAEP');
        expect(code).toContain('/encrypt-for-session');
        expect(code).toContain('$helpers.httpRequest');
        expect(code).not.toContain('crypto.publicEncrypt(');
        expect(code).not.toContain("require('crypto')");
    });

    it('04: "Generate Session Keys" calls /generate-session-key, no local crypto.randomBytes/publicEncrypt', () => {
        const code = loadNode('04-ksef-invoice-retrieval.json', 'Generate Session Keys');
        expect(code).toContain('/generate-session-key');
        expect(code).toContain('$helpers.httpRequest');
        expect(code).not.toContain('crypto.randomBytes(');
        expect(code).not.toContain('crypto.publicEncrypt(');
        expect(code).not.toContain("require('crypto')");
        // Downstream nodes (Prepare Invoice Query, Open Online Session) still
        // read these exact field names - the sidecar response is reshaped to
        // match, not the other way around.
        expect(code).toContain('encryptedSymmetricKey');
        expect(code).toContain('initializationVector');
        expect(code).toContain('aesKeyHex');
        expect(code).toContain('ivHex');
    });

    it('both retained sidecar callers reference $env.XADES_SIDECAR_URL with the hyphenated fallback', () => {
        for (const [file, name] of [
            ['02-ksef-authenticate.json', 'Encrypt Token RSA-OAEP'],
            ['04-ksef-invoice-retrieval.json', 'Generate Session Keys'],
        ] as const) {
            const code = loadNode(file, name);
            expect(code).toContain('$env.XADES_SIDECAR_URL');
            expect(code).toContain("'http://xades-sidecar:8090'");
            expect(code).not.toMatch(/xades_sidecar/);
        }
    });
});
