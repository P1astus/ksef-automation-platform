import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1';

export class MissingCredentialKeyError extends Error {
    constructor() {
        super('KSEF_CREDENTIALS_KEY is not configured');
        this.name = 'MissingCredentialKeyError';
    }
}

function key(): Buffer {
    const configured = process.env.KSEF_CREDENTIALS_KEY;
    if (!configured) throw new MissingCredentialKeyError();

    const decoded = /^[0-9a-f]{64}$/i.test(configured)
        ? Buffer.from(configured, 'hex')
        : Buffer.from(configured, 'base64');
    if (decoded.length !== 32) {
        throw new Error('KSEF_CREDENTIALS_KEY must contain exactly 32 bytes (base64 or 64 hex characters)');
    }
    return decoded;
}

export function isEncryptedSecret(value: string): boolean {
    return value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(stored: string, context: string): string {
    if (!isEncryptedSecret(stored)) {
        // Rows written by the old settings route were plain Base64. Keep
        // them readable only for the migration window; every new write is
        // an authenticated AES-GCM envelope.
        const decoded = Buffer.from(stored, 'base64');
        const canonical = decoded.toString('base64').replace(/=+$/, '');
        const input = stored.replace(/=+$/, '');
        return canonical === input ? decoded.toString('utf8') : stored;
    }

    const parts = stored.split(':');
    if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
        throw new Error('Unsupported encrypted credential format');
    }
    const [, , iv64, tag64, encrypted64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv64, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted64, 'base64')), decipher.final()]).toString('utf8');
}

export function clientCredentialContext(clientId: string | number): string {
    return `ksef-client:${clientId}`;
}
