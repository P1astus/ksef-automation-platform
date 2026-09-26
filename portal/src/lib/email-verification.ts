import crypto from 'crypto';
import { query } from './db';
import { appUrl } from './app-url';
import { sendEmailVerification } from './email';

// Single-use links that prove control of an owner e-mail address (hosted
// sign-up, login e-mail change). Only the SHA-256 of a token is stored.
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export function hashVerifyToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

// Replaces any previous link of this firm and mails the new one to `to`.
export async function issueEmailVerification(firmId: number, to: string, purpose: 'signup' | 'change'): Promise<void> {
    const token = crypto.randomBytes(32).toString('hex');
    await query(
        'UPDATE firms SET email_verify_token = $1, email_verify_expires_at = $2 WHERE id = $3',
        [hashVerifyToken(token), new Date(Date.now() + EMAIL_VERIFY_TTL_MS), firmId]
    );
    await sendEmailVerification(to, `${appUrl()}/verify-email/${token}`, purpose);
}
