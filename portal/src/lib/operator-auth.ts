import { SignJWT, jwtVerify } from 'jose';
import { createHmac } from 'crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { query } from './db';
import { MissingJwtSecretError } from './auth';

// Vendor/admin-console authentication. Kept entirely separate from the tenant
// session in auth.ts:
//  - its own cookie (`operator_session`), SameSite=Strict, no sliding expiry;
//  - signed with a key DERIVED from JWT_SECRET, so a firm `session` JWT can
//    never verify as an operator token or vice versa (auth.ts's decrypt()
//    accepts any HS256 token signed with the raw secret - a shared key would
//    make the two interchangeable);
//  - every request re-checks operators.is_active in the DB, so disabling an
//    operator takes effect immediately (admin traffic is tiny; no cache) and
//    a DB error fails closed.

export const OPERATOR_COOKIE = 'operator_session';
const OPERATOR_TTL_SECONDS = 4 * 60 * 60;
const AUDIENCE = 'ksef-operator';

let key: Uint8Array | null = null;
function getKey(): Uint8Array {
    if (key) return key;
    if (!process.env.JWT_SECRET) throw new MissingJwtSecretError();
    key = new Uint8Array(createHmac('sha256', process.env.JWT_SECRET).update('ksef-operator-session-v1').digest());
    return key;
}

export interface OperatorSession {
    operatorId: number;
    email: string;
}

export async function signOperatorToken(operatorId: number, email: string): Promise<string> {
    return new SignJWT({ operatorId, email })
        .setProtectedHeader({ alg: 'HS256' })
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${OPERATOR_TTL_SECONDS}s`)
        .sign(getKey());
}

export async function verifyOperatorToken(token: string): Promise<OperatorSession | null> {
    try {
        const { payload } = await jwtVerify(token, getKey(), { algorithms: ['HS256'], audience: AUDIENCE });
        if (typeof payload.operatorId !== 'number' || typeof payload.email !== 'string') return null;
        return { operatorId: payload.operatorId, email: payload.email };
    } catch (error) {
        if (error instanceof MissingJwtSecretError) throw error;
        return null;
    }
}

export async function setOperatorCookie(operatorId: number, email: string) {
    const store = await cookies();
    store.set(OPERATOR_COOKIE, await signOperatorToken(operatorId, email), {
        maxAge: OPERATOR_TTL_SECONDS,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
    });
}

export async function clearOperatorCookie() {
    const store = await cookies();
    store.set(OPERATOR_COOKIE, '', { expires: new Date(0), path: '/' });
}

// Valid token AND the operator still exists and is active.
export async function getOperatorSession(): Promise<OperatorSession | null> {
    const store = await cookies();
    const token = store.get(OPERATOR_COOKIE)?.value;
    if (!token) return null;
    const session = await verifyOperatorToken(token);
    if (!session) return null;
    const res = await query('SELECT is_active FROM operators WHERE id = $1 AND email = $2', [session.operatorId, session.email]);
    return res.rows[0]?.is_active === true ? session : null;
}

// For server components: returns the session or redirects to the login page.
// EVERY console page must call this itself before touching data - Next.js can
// render a layout and its page concurrently, so a layout-only guard would let
// the page's queries run for an unauthenticated request.
export async function requireOperator(): Promise<OperatorSession> {
    const session = await getOperatorSession();
    if (!session) redirect('/admin/login');
    return session;
}

export async function clientIp(): Promise<string | null> {
    const h = await headers();
    return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || null;
}

export async function auditOperator(
    entry: { operatorId: number | null; email: string | null; action: string; firmId?: number | null; details?: unknown }
) {
    const ip = await clientIp();
    // Deliberately NOT swallowed: a view of tenant data that cannot be audited
    // must not proceed (callers await this before rendering/returning data).
    await query(
        `INSERT INTO operator_audit_log (operator_id, operator_email, action, firm_id, ip, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.operatorId, entry.email, entry.action, entry.firmId ?? null, ip, entry.details === undefined ? null : JSON.stringify(entry.details)]
    );
}

// --- login throttling -------------------------------------------------------
// In-process (single portal container), per email+ip. Not a substitute for
// real rate limiting at nginx, but stops trivial password guessing.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, number[]>();

function recent(k: string, now: number): number[] {
    const list = (failures.get(k) ?? []).filter(t => now - t < WINDOW_MS);
    failures.set(k, list);
    return list;
}
export function isThrottled(k: string, now = Date.now()): boolean {
    return recent(k, now).length >= MAX_FAILURES;
}
export function recordFailure(k: string, now = Date.now()) {
    recent(k, now).push(now);
}
export function clearFailures(k: string) {
    failures.delete(k);
}
export function _resetThrottleForTests() {
    failures.clear();
}

// Compared against when the email is unknown, so an unknown account costs the
// same bcrypt time as a wrong password (no account-existence timing signal).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-operator-password', 12);

export type OperatorLoginResult =
    | { ok: true; operatorId: number; email: string }
    | { ok: false; reason: 'invalid' | 'throttled' };

export async function verifyOperatorLogin(emailInput: string, password: string, ip: string | null): Promise<OperatorLoginResult> {
    const email = emailInput.trim().toLowerCase();
    const k = `${email}|${ip ?? ''}`;
    if (isThrottled(k)) return { ok: false, reason: 'throttled' };

    const res = await query('SELECT id, password_hash, is_active FROM operators WHERE email = $1', [email]);
    const row = res.rows[0];
    const valid = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !row.is_active || !valid) {
        recordFailure(k);
        return { ok: false, reason: 'invalid' };
    }
    clearFailures(k);
    await query('UPDATE operators SET last_login_at = NOW() WHERE id = $1', [row.id]);
    return { ok: true, operatorId: row.id, email };
}
