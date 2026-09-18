import { NextResponse } from 'next/server';
import { getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { requireActiveSubscription } from '@/lib/entitlements';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // Fetch invoice and verify firm ownership directly against invoices.firm_id
    // (not via a clients join on client_nip, which a shared NIP could defeat)
    const res = await query(
        `SELECT i.id, i.invoice_number, i.ksef_number, i.direction, i.processing_status,
                i.seller_name, i.buyer_name, i.seller_nip, i.buyer_nip,
                i.buyer_street, i.buyer_city, i.buyer_postal_code,
                i.net_amount, i.vat_amount, i.gross_amount, i.currency,
                i.issue_date, i.raw_xml, i.invoice_lines,
                i.corrects_invoice_id, i.correction_reason, i.ksef_rejection_reason
         FROM invoices i
         WHERE i.id = $1 AND i.firm_id = $2`,
        [id, session.firmId]
    );

    if (!res.rows[0]) return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });

    return NextResponse.json(res.rows[0]);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const roleError = await requireRole(session, ['owner', 'admin', 'member']);
    if (roleError) return roleError;
    const subscriptionError = await requireActiveSubscription(session.firmId);
    if (subscriptionError) return subscriptionError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { processing_status } = body;

    const allowed = ['new', 'classified', 'error'];
    if (!allowed.includes(processing_status)) {
        return NextResponse.json({ error: 'Nieprawidłowy status' }, { status: 400 });
    }

    // Verify ownership directly against invoices.firm_id
    const check = await query(
        `SELECT i.id FROM invoices i WHERE i.id = $1 AND i.firm_id = $2`,
        [id, session.firmId]
    );
    if (!check.rows[0]) return NextResponse.json({ error: 'Nie znaleziono' }, { status: 404 });

    await query('UPDATE invoices SET processing_status = $1 WHERE id = $2', [processing_status, id]);

    return NextResponse.json({ ok: true });
}
