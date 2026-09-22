import { capabilities } from '@/lib/deployment';
import { requireLicenceWrite } from '@/lib/entitlements';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { safeEqual } from '@/lib/auth';
import { assertMailTransportConfigured } from '@/lib/mail-transport';
import { notifyReceivables } from '@/lib/notifications/receivables';

// Called weekly by workflows/09-client-notifications.json. Same shared-
// secret pattern as digest/route.ts and notify/offline24/route.ts.
//
// Informational only — a periodic summary of the client's own overdue
// receivables, sent to clients.contact_email. Deliberately not a dunning
// notice to the invoice's buyer: buyer_nip/buyer_name are free-text with no
// captured contact info anywhere in the schema, so there's nothing to email
// them at without adding new data collection (a real, separate feature).
export async function POST(request: Request) {
    const auth = request.headers.get('Authorization');
    const secret = process.env.NOTIFY_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'NOTIFY_SECRET is not configured' }, { status: 503 });
    }
    if (!safeEqual(auth || '', `Bearer ${secret}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (capabilities().accessProvider === 'licence') {
        const firm = await query('SELECT id FROM firms WHERE is_active = true LIMIT 1');
        if (firm.rows[0]) { const licenceError = await requireLicenceWrite(firm.rows[0].id); if (licenceError) return licenceError; }
    }
    try {
        assertMailTransportConfigured();
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
    }
    const result = await notifyReceivables({ db: { query }, now: () => new Date(), shadow: false, signal: request.signal });
    const failed = result.failures?.length ?? 0;
    return NextResponse.json({
        ok: failed === 0, sent: result.processed ?? 0, failed,
        clientsWithOverdue: result.detail.clientsWithOverdue,
    }, { status: failed === 0 ? 200 : 502 });
}
