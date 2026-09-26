import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AES-GCM on Node 20 (the production image) accepts authentication tags as
// short as 4 bytes unless the tag length is pinned, which makes forging a
// stored credential cheap. Newer Node rejects them on its own, so this test
// checks the decipher is created with the length pinned, not the host's Node.
const seen = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('crypto')>();
    return {
        ...actual,
        createDecipheriv: (...args: Parameters<typeof actual.createDecipheriv>) => {
            seen.options.push(args[3]);
            return actual.createDecipheriv(...args);
        },
    };
});

describe('credential decryption tag length', () => {
    const previous = process.env.KSEF_CREDENTIALS_KEY;
    beforeEach(() => { process.env.KSEF_CREDENTIALS_KEY = 'a'.repeat(64); seen.options = []; });
    afterEach(() => { process.env.KSEF_CREDENTIALS_KEY = previous; });

    it('pins a 16-byte GCM tag when decrypting', async () => {
        const { decryptSecret, encryptSecret } = await import('../credential-crypto');
        expect(decryptSecret(encryptSecret('token-123', 'ksef-client:1'), 'ksef-client:1')).toBe('token-123');
        expect(seen.options).toEqual([expect.objectContaining({ authTagLength: 16 })]);
    });
});
