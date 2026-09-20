import { createHash, randomBytes } from 'crypto';

// First-run possession proof for the local edition. The token is high-entropy (32 CSPRNG bytes), so a plain
// SHA-256 is the right hash (no salt/stretching needed for a random secret). scripts/lib/setup-token.mjs must
// hash identically; a test asserts the two agree.

export function generateSetupToken(): string {
    return randomBytes(32).toString('base64url');
}

export function hashSetupToken(raw: string): string {
    return createHash('sha256').update(raw.trim(), 'utf8').digest('hex');
}
