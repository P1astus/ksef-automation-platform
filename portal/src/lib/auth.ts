import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { tierHasFeature } from './plans';

// Round 11 fix: digest/route.ts, notify/offline24/route.ts and
// notify/receivables/route.ts each compared their shared-secret
// (DIGEST_SECRET/NOTIFY_SECRET) Authorization header with a plain `!==`,
// the same non-constant-time comparison class the sidecar's
// SidecarApiKeyFilter (round 4) was built specifically to avoid — a plain
// string compare short-circuits on the first mismatched byte, leaking
// timing information an attacker could use to guess the secret
// byte-by-byte. Buffer lengths must match before calling timingSafeEqual
// (it throws otherwise), which is itself safe to branch on since it only
// leaks the secret's length, not any of its bytes.
export function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
}

// Checked lazily (on first actual use) rather than at module load: `next
// build` statically imports and evaluates every route module to collect
// page data, with no JWT_SECRET available at build time - a module-level
// throw here broke `docker build` itself, not just a misconfigured runtime.
// A session can still never be signed or verified without the real secret;
// the check just fires at first use instead of at import time.
export class MissingJwtSecretError extends Error {
    constructor() {
        super('JWT_SECRET is not set. Refusing to sign or verify sessions: a missing secret would let anyone forge a session for any firmId.');
        this.name = 'MissingJwtSecretError';
    }
}

let key: Uint8Array | null = null;

function getKey(): Uint8Array {
    if (key) return key;
    if (!process.env.JWT_SECRET) {
        throw new MissingJwtSecretError();
    }
    key = new TextEncoder().encode(process.env.JWT_SECRET);
    return key;
}

export async function encrypt(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(getKey());
}

export async function decrypt(input: string): Promise<any> {
    const { payload } = await jwtVerify(input, getKey(), {
        algorithms: ['HS256'],
    });
    return payload;
}

export type SessionRole = 'owner' | 'admin' | 'member' | 'readonly';

// `userId` is the firm_users.id of an invited team member, or null for the
// firm owner (who authenticates against firms.admin_email directly and has
// no firm_users row). `role` is 'owner' for the firm owner (always full
// access) or the invited member's firm_users.role otherwise.
export async function createSession(
    firmId: number,
    adminEmail: string,
    role: SessionRole = 'owner',
    userId: number | null = null
) {
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
    const session = await encrypt({ firmId, adminEmail, role, userId, expires });

    const cookieStore = await cookies();
    cookieStore.set('session', session, {
        expires,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}

// Sessions created before this field existed have no `role` — treat that as
// 'owner' (the only kind of session createSession() could produce before),
// not as unauthorized. A brand new login always gets an explicit role.
export function sessionRole(session: { role?: SessionRole }): SessionRole {
    return session.role ?? 'owner';
}

// Use in a route handler after getSession(): returns a 403 NextResponse if
// the session's role isn't in `allowed`, or null if the caller may proceed.
export async function requireRole(session: { role?: SessionRole } | null, allowed: SessionRole[]) {
    const { NextResponse } = await import('next/server');
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!allowed.includes(sessionRole(session))) {
        return NextResponse.json({ error: 'Brak uprawnień do tej operacji' }, { status: 403 });
    }
    return null;
}

// Round 13 fix: nothing re-checked firms.is_active once a session existed, and
// updateSession() slides the cookie's expiry forward on every request, so a
// team member of a firm deactivated after they logged in stayed logged in for
// as long as they kept using the portal - login/route.ts only closes *new*
// sessions. getSession() now checks the firm on every call, cached briefly
// per firm to keep this off the hot path. The cache is per process (the portal
// is a single container); settings/route.ts's deactivate_account clears its own
// entry, any other way of flipping the flag lags by at most the TTL.
const FIRM_ACTIVE_TTL_MS = 30_000;
const firmActiveCache = new Map<number, { active: boolean; tier: unknown; at: number }>();

export function invalidateFirmActiveCache(firmId?: number) {
    if (firmId === undefined) firmActiveCache.clear();
    else firmActiveCache.delete(firmId);
}

async function loadFirmAccess(firmId: number): Promise<{ active: boolean; tier: unknown }> {
    const hit = firmActiveCache.get(firmId);
    if (hit && Date.now() - hit.at < FIRM_ACTIVE_TTL_MS) return hit;
    // Lazy import keeps `pg` out of middleware's bundle, which only needs
    // getSessionUnchecked(). A DB error propagates on purpose: failing open
    // here would let a deactivated firm's sessions through during an outage.
    const { query } = await import('./db');
    const res = await query('SELECT is_active, subscription_tier FROM firms WHERE id = $1', [firmId]);
    const entry = { active: res.rows[0]?.is_active === true, tier: res.rows[0]?.subscription_tier, at: Date.now() };
    firmActiveCache.set(firmId, entry);
    return entry;
}

// JWT verification only, no DB access - safe for middleware. Route handlers and
// server components should use getSession(), which also enforces firms.is_active.
export async function getSessionUnchecked() {
    const cookieStore = await cookies();
    const session = cookieStore.get('session')?.value;
    if (!session) return null;
    try {
        return await decrypt(session);
    } catch (error) {
        if (error instanceof MissingJwtSecretError) throw error;
        return null;
    }
}

export async function getSession() {
    const session = await getSessionUnchecked();
    if (!session) return null;
    const access = await loadFirmAccess(session.firmId);
    if (!access.active) return null;
    // Team seats are a Biznes+ feature. Invited members (userId set) of a firm
    // that has since downgraded lose their session here; the owner never does.
    // Shares the 30 s cache above, so a webhook-driven downgrade lags by at
    // most the TTL - settings/billing code should call invalidateFirmActiveCache().
    if (session.userId != null && !tierHasFeature(access.tier, 'team')) return null;
    // A member's JWT is deliberately only a session credential, not an
    // authority record. Team removal must take effect immediately: otherwise
    // updateSession() keeps sliding a deleted member's cookie indefinitely.
    // Do not cache this lookup; removal is a security boundary and it also
    // picks up a role change without waiting for the firm-access TTL.
    if (session.userId != null) {
        const { query } = await import('./db');
        const member = await query(
            'SELECT id, role FROM firm_users WHERE id = $1 AND firm_id = $2 AND is_active = true',
            [session.userId, session.firmId]
        );
        if (!member.rows[0]) return null;
        session.role = member.rows[0].role;
    }
    return session;
}

export async function logout() {
    const cookieStore = await cookies();
    cookieStore.set('session', '', {
        expires: new Date(0),
        path: '/',
    });
}

export async function updateSession(request: NextRequest) {
    const session = request.cookies.get('session')?.value;
    if (!session) return;

    try {
        const parsed = await decrypt(session);
        const expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
        parsed.expires = expires;
        const res = NextResponse.next();
        res.cookies.set({
            name: 'session',
            value: await encrypt(parsed),
            httpOnly: true,
            expires,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
        });
        return res;
    } catch (error) {
        if (error instanceof MissingJwtSecretError) throw error;
        // Stale or tampered cookie — clear it and continue
        const res = NextResponse.next();
        res.cookies.set({ name: 'session', value: '', expires: new Date(0), path: '/' });
        return res;
    }
}
