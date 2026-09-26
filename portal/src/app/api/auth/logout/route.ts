import { NextResponse } from 'next/server';
import { getSessionUnchecked, logout, revokeSessions } from '@/lib/auth';

export async function POST() {
    // Ending the session server-side, not only clearing this browser's cookie:
    // a copy of the token must stop working too. This signs the account out
    // everywhere.
    const session = await getSessionUnchecked();
    if (session?.firmId) await revokeSessions(session.firmId, session.userId ?? null);
    await logout();
    return NextResponse.json({ success: true, redirectUrl: '/login' });
}
