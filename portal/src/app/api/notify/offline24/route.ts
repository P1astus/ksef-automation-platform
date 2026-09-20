import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { safeEqual } from '@/lib/auth';
import { assertMailTransportConfigured } from '@/lib/mail-transport';
import { notifyOffline24 } from '@/lib/notifications/offline24';

// Called by workflows/09-client-notifications.json every 2 hours. Protected
// by a shared secret exactly like digest/route.ts: Authorization: Bearer
// <NOTIFY_SECRET>.
//
// This is the CLIENT-facing counterpart to 05-offline24-monitor.json's
// internal ops alerts — same urgency tiers (overdue / <1h / <4h, matching
// that workflow's "Calculate Time Remaining" Code node exactly, read
// directly rather than re-derived), but a separate set of
// client_notified_* flags on offline_invoices, since "did ops get paged"
// and "did the client get emailed" are different signals that shouldn't be
// conflated onto the same columns.
export async function POST(request: Request) {
    const auth = request.headers.get('Authorization');
    const secret = process.env.NOTIFY_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'NOTIFY_SECRET is not configured' }, { status: 503 });
    }
    if (!safeEqual(auth || '', `Bearer ${secret}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
        assertMailTransportConfigured();
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
    }
    const result = await notifyOffline24({ db: { query }, now: () => new Date(), shadow: false, signal: request.signal });
    const failed = result.failures?.length ?? 0;
    return NextResponse.json({ ok: failed === 0, sent: result.processed ?? 0, failed }, { status: failed === 0 ? 200 : 502 });
}
