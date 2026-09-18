import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendDailyDigest } from '@/lib/email';
import { safeEqual } from '@/lib/auth';

// Called by n8n cron at 7:00 AM daily
// Or manually: POST /api/digest
// Protected by a shared secret: Authorization: Bearer <DIGEST_SECRET>
export async function POST(request: Request) {
    const auth = request.headers.get('Authorization');
    const secret = process.env.DIGEST_SECRET;
    if (!secret) {
        return NextResponse.json({ error: 'DIGEST_SECRET is not configured' }, { status: 503 });
    }
    if (!safeEqual(auth || '', `Bearer ${secret}`)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!process.env.RESEND_API_KEY) {
        return NextResponse.json({ error: 'RESEND_API_KEY is not configured' }, { status: 503 });
    }

    const firmsRes = await query(`
        SELECT id, firm_name, admin_email
        FROM firms
        WHERE is_active = true AND subscription_status IN ('active', 'trial')
    `);

    let sent = 0;
    let failed = 0;
    for (const firm of firmsRes.rows) {
        try {
            const statsRes = await query(`
                SELECT
                    COUNT(*) FILTER (WHERE i.created_at >= NOW() - INTERVAL '1 day') as yesterday,
                    COUNT(*) as total
                FROM invoices i
                WHERE i.firm_id = $1
            `, [firm.id]);

            const errRes = await query(`
                SELECT COUNT(*) as errors
                FROM activity_log
                WHERE firm_id = $1 AND event_type = 'sync_error' AND created_at >= NOW() - INTERVAL '1 day'
            `, [firm.id]).catch(() => ({ rows: [{ errors: 0 }] }));

            await sendDailyDigest(firm.admin_email, firm.firm_name, {
                invoicesYesterday: parseInt(statsRes.rows[0].yesterday) || 0,
                clientsSynced: 0,
                errors: parseInt(errRes.rows[0].errors) || 0,
                totalInvoices: parseInt(statsRes.rows[0].total) || 0,
            });
            sent++;
        } catch (error) {
            failed++;
            console.error(`Daily digest failed for firm ${firm.id}:`, error);
        }
    }

    return NextResponse.json({ ok: failed === 0, sent, failed }, { status: failed === 0 ? 200 : 502 });
}
