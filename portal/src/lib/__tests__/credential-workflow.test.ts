import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { encryptSecret, decryptSecret, clientCredentialContext } from '../credential-crypto';

const ROOT = join(__dirname, '..', '..', '..', '..');

// Encrypted KSeF credentials used to be decrypted by n8n (workflow 02's Code node). The invoice-retrieval job in the
// worker is now the only reader outside the portal, so the same guarantees are pinned on that path.
describe('encrypted credentials stay usable by the invoice-retrieval worker', () => {
    it('compose passes the key to the portal, n8n (legacy) and the worker', () => {
        const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
        expect(compose.match(/KSEF_CREDENTIALS_KEY=/g)).toHaveLength(3);
    });

    it('the registered job decrypts with decryptSecret() bound to the per-client AAD (a ciphertext cannot be moved between rows)', () => {
        const registry = readFileSync(join(__dirname, '..', 'jobs', 'registry.ts'), 'utf8');
        expect(registry).toContain('decryptSecret(stored, clientCredentialContext(clientId))');
    });

    it('a token stored by the settings route decrypts for its own client id and only its own', () => {
        process.env.KSEF_CREDENTIALS_KEY = 'a'.repeat(64);
        const stored = encryptSecret('the-ksef-token', clientCredentialContext(42));
        expect(decryptSecret(stored, clientCredentialContext(42))).toBe('the-ksef-token');
        expect(() => decryptSecret(stored, clientCredentialContext(43))).toThrow();
    });
});
