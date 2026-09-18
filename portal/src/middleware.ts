import { NextRequest, NextResponse } from 'next/server';
import { getSessionUnchecked, updateSession } from '@/lib/auth';

// Add paths that require authentication here
const protectedPaths = ['/dashboard'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Check if path is protected
    const isProtectedPath = protectedPaths.some(path => pathname.startsWith(path));

    // Update session if it exists; also forward pathname as header for server components
    const res = await updateSession(request);
    if (res) {
        res.headers.set('x-pathname', pathname);
    }

    if (isProtectedPath) {
        const session = await getSessionUnchecked();

        // Redirect to login if accessing protected route without valid session
        if (!session) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('redirect', pathname);
            return NextResponse.redirect(loginUrl);
        }
    }

    // Redirect to dashboard if logged in and trying to access login/register/home
    // (but not /demo — let logged-in users view demo too)
    // ?session=ended: the dashboard rejected a JWT-valid session (e.g. deactivated
    // firm) - don't bounce straight back to /dashboard, that would loop.
    if (request.nextUrl.searchParams.get('session') !== 'ended' && (pathname === '/login' || pathname === '/register' || pathname === '/') && await getSessionUnchecked()) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return res || NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
