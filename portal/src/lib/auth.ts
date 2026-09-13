import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const secretKey = process.env.JWT_SECRET || 'fallback-secret-for-dev-only-change-in-prod';
const key = new TextEncoder().encode(secretKey);

export async function encrypt(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(key);
}

export async function decrypt(input: string): Promise<any> {
    const { payload } = await jwtVerify(input, key, {
        algorithms: ['HS256'],
    });
    return payload;
}

export async function createSession(firmId: number, adminEmail: string) {
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
    const session = await encrypt({ firmId, adminEmail, expires });

    const cookieStore = await cookies();
    cookieStore.set('session', session, {
        expires,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}

export async function getSession() {
    const cookieStore = await cookies();
    const session = cookieStore.get('session')?.value;
    if (!session) return null;
    try {
        return await decrypt(session);
    } catch (error) {
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
    } catch {
        // Stale or tampered cookie — clear it and continue
        const res = NextResponse.next();
        res.cookies.set({ name: 'session', value: '', expires: new Date(0), path: '/' });
        return res;
    }
}
