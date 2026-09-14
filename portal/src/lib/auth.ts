import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

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

export async function getSession() {
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
