import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendOffline24Warning } from '@/lib/email';
import { safeEqual } from '@/lib/auth';

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
    if (!process.env.RESEND_API_KEY) {
        return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 503 });
    }

    const pending = await query(`
        SELECT oi.id, oi.invoice_number, oi.upload_deadline,
               oi.client_notified_4h, oi.client_notified_1h, oi.client_notified_overdue,
               c.contact_email, c.client_name
        FROM offline_invoices oi
        JOIN clients c ON oi.client_nip = c.nip AND oi.firm_id = c.firm_id
        WHERE oi.uploaded_to_ksef = false AND c.contact_email IS NOT NULL
          AND NOT (oi.client_notified_4h AND oi.client_notified_1h AND oi.client_notified_overdue)
    `);

    let sent = 0;
    let failed = 0;
    const now = Date.now();
    for (const row of pending.rows) {
        const diffMs = new Date(row.upload_deadline).getTime() - now;
        const diffHours = diffMs / (1000 * 60 * 60);

        let tier: '4h' | '1h' | 'overdue' | null = null;
        let flagColumn: string | null = null;
        if (diffMs <= 0 && !row.client_notified_overdue) { tier = 'overdue'; flagColumn = 'client_notified_overdue'; }
        else if (diffHours < 1 && !row.client_notified_1h) { tier = '1h'; flagColumn = 'client_notified_1h'; }
        else if (diffHours < 4 && !row.client_notified_4h) { tier = '4h'; flagColumn = 'client_notified_4h'; }

        if (!tier || !flagColumn) continue;

        try {
            await sendOffline24Warning(row.contact_email, row.client_name, row.invoice_number, row.upload_deadline, tier);
            await query(`UPDATE offline_invoices SET ${flagColumn} = true WHERE id = $1`, [row.id]);
            sent++;
        } catch (error) {
            failed++;
            // The flag remains false, so the next scheduled run can retry.
            // Do not hide this: the response below is non-2xx if any warning
            // could not be delivered, allowing n8n's error handling to alert.
            console.error(`Offline24 ${tier} warning failed for queue row ${row.id}:`, error);
        }
    }

    return NextResponse.json({ ok: failed === 0, sent, failed }, { status: failed === 0 ? 200 : 502 });
}
