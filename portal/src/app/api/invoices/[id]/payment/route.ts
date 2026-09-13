import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { logActivity } from '@/lib/activity';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { payment_status, paid_at } = body;

    if (!['paid', 'unpaid'].includes(payment_status)) {
        return NextResponse.json({ error: 'Nieprawidłowy status płatności' }, { status: 400 });
    }

    // Verify invoice belongs to firm (checked directly against invoices.firm_id,
    // not via a clients join on client_nip - a NIP can now belong to more than
    // one firm, so a join without firm_id in the ON clause could match another
    // firm's client row and authorize access to someone else's invoice)
    const check = await query(
        `SELECT i.id FROM invoices i WHERE i.id = $1 AND i.firm_id = $2`,
        [id, session.firmId]
    );
    if (!check.rows[0]) return NextResponse.json({ error: 'Nie znaleziono faktury' }, { status: 404 });

    await query(
        `UPDATE invoices SET payment_status = $1, paid_at = $2 WHERE id = $3`,
        [payment_status, payment_status === 'paid' ? (paid_at || new Date().toISOString()) : null, id]
    );

    await logActivity(
        session.firmId,
        'payment_updated',
        `Faktura #${id}: ${payment_status === 'paid' ? 'oznaczono jako zapłacona' : 'oznaczono jako niezapłacona'}`
    );

    return NextResponse.json({ ok: true });
}
