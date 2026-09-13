import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const res = await query(
        `SELECT i.id, i.invoice_number, i.ksef_number, i.issue_date,
                i.seller_name, i.buyer_name, i.gross_amount, i.currency,
                i.offline_mode, i.offline_upload_deadline, i.is_offline,
                c.client_name
         FROM invoices i
         JOIN clients c ON i.client_nip = c.nip AND i.firm_id = c.firm_id
         WHERE i.firm_id = $1
           AND i.is_offline = true
           AND i.offline_uploaded = false
         ORDER BY i.offline_upload_deadline ASC NULLS LAST`,
        [session.firmId]
    );

    return NextResponse.json({ invoices: res.rows });
}
