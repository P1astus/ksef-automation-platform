import { afterEach, describe, expect, it } from 'vitest';
import { clientCredentialContext, decryptSecret, encryptSecret, isEncryptedSecret, MissingCredentialKeyError } from '../credential-crypto';

const original = process.env.KSEF_CREDENTIALS_KEY;

afterEach(() => {
    if (original === undefined) delete process.env.KSEF_CREDENTIALS_KEY;
    else process.env.KSEF_CREDENTIALS_KEY = original;
});

describe('credential encryption', () => {
    it('round-trips with AES-256-GCM without storing plaintext', () => {
        process.env.KSEF_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
        const encrypted = encryptSecret('very-secret-token', clientCredentialContext(12));
        expect(isEncryptedSecret(encrypted)).toBe(true);
        expect(encrypted).not.toContain('very-secret-token');
        expect(decryptSecret(encrypted, clientCredentialContext(12))).toBe('very-secret-token');
    });

    it('binds ciphertext to the client context', () => {
        process.env.KSEF_CREDENTIALS_KEY = Buffer.alloc(32, 8).toString('hex');
        const encrypted = encryptSecret('token', clientCredentialContext(12));
        expect(() => decryptSecret(encrypted, clientCredentialContext(13))).toThrow();
    });

    it('reads legacy Base64 rows during migration', () => {
        expect(decryptSecret(Buffer.from('old-token').toString('base64'), clientCredentialContext(1))).toBe('old-token');
        expect(decryptSecret('FAKE_STRESS_TOKEN_1', clientCredentialContext(1))).toBe('FAKE_STRESS_TOKEN_1');
    });

    it('refuses new writes without an encryption key', () => {
        delete process.env.KSEF_CREDENTIALS_KEY;
        expect(() => encryptSecret('token', clientCredentialContext(1))).toThrow(MissingCredentialKeyError);
    });
});
