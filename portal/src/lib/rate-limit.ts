import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { query } from './db';

export interface RateLimitResult {
    allowed: boolean;
    retryAfterSeconds: number;
}

function subjectHash(scope: string, subject: string): string {
    return createHash('sha256').update(`${scope}\0${subject.trim().toLowerCase()}`).digest('hex');
}

export function requestIp(request: Request): string {
    // X-Real-IP is overwritten by our nginx proxy with $remote_addr. Never
    // use X-Forwarded-For as a fallback: it is an append-only chain and its
    // left-most entry can be supplied by the client.
    return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function consumeRateLimit(scope: string, subject: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const result = await query(
        `INSERT INTO auth_rate_limits (scope, subject_hash, window_started_at, attempts)
         VALUES ($1, $2, NOW(), 1)
         ON CONFLICT (scope, subject_hash) DO UPDATE SET
             attempts = CASE
                 WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 millisecond') THEN 1
                 ELSE auth_rate_limits.attempts + 1
             END,
             window_started_at = CASE
                 WHEN auth_rate_limits.window_started_at <= NOW() - ($3 * INTERVAL '1 millisecond') THEN NOW()
                 ELSE auth_rate_limits.window_started_at
             END
         RETURNING attempts, window_started_at`,
        [scope, subjectHash(scope, subject), windowMs]
    );
    const row = result.rows[0];
    const elapsed = Date.now() - new Date(row.window_started_at).getTime();
    return {
        allowed: Number(row.attempts) <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
    };
}

export function rateLimitResponse(result: RateLimitResult) {
    return NextResponse.json(
        { error: 'Zbyt wiele prób. Spróbuj ponownie później.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } }
    );
}
