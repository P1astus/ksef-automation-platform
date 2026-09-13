import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;

    // Fetch invoice and verify firm ownership via clients join
    const res = await query(
        `SELECT i.id, i.invoice_number, i.ksef_number, i.direction, i.processing_status,
                i.seller_name, i.buyer_name, i.seller_nip, i.buyer_nip,
                i.net_amount, i.vat_amount, i.gross_amount, i.currency,
                i.issue_date, i.raw_xml
         FROM invoices i
         JOIN clients c ON i.client_nip = c.nip
         WHERE i.id = $1 AND c.firm_id = $2`,
        [id, session.firmId]
    );

    if (!res.rows[0]) return NextResponse.json({ error: 'Faktura nie znaleziona' }, { status: 404 });

    return NextResponse.json(res.rows[0]);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { processing_status } = body;

    const allowed = ['new', 'classified', 'error'];
    if (!allowed.includes(processing_status)) {
        return NextResponse.json({ error: 'Nieprawidłowy status' }, { status: 400 });
    }

    // Verify ownership
    const check = await query(
        `SELECT i.id FROM invoices i JOIN clients c ON i.client_nip = c.nip
         WHERE i.id = $1 AND c.firm_id = $2`,
        [id, session.firmId]
    );
    if (!check.rows[0]) return NextResponse.json({ error: 'Nie znaleziono' }, { status: 404 });

    await query('UPDATE invoices SET processing_status = $1 WHERE id = $2', [processing_status, id]);

    return NextResponse.json({ ok: true });
}
