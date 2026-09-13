import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Reads from offline_invoices (what 05-offline24-monitor.json also
    // queries), not invoices.is_offline/offline_upload_deadline - nothing
    // ever wrote to those columns (see
    // migrations/2026-09-13-offline-invoice-linking.sql). invoice_id joins
    // back to invoices for display fields the offline_invoices table was
    // never meant to duplicate.
    const res = await query(
        `SELECT i.id, i.invoice_number, i.ksef_number, i.issue_date,
                i.seller_name, i.buyer_name, i.gross_amount, i.currency,
                oi.offline_mode, oi.upload_deadline AS offline_upload_deadline,
                c.client_name
         FROM offline_invoices oi
         JOIN invoices i ON i.id = oi.invoice_id
         JOIN clients c ON c.nip = oi.client_nip AND c.firm_id = oi.firm_id
         WHERE oi.firm_id = $1
           AND oi.uploaded_to_ksef = false
         ORDER BY oi.upload_deadline ASC NULLS LAST`,
        [session.firmId]
    );

    return NextResponse.json({ invoices: res.rows });
}
